import { AutoModel, Tensor } from "@huggingface/transformers";
import type * as Worklet from "../worklet";

export type Message = Init;

export interface Speaking {
	type: "speaking";

	// If empty, the speaking event has ended.
	samples: Float32Array;

	padding?: "start" | "end";
}

export interface NotSpeaking {
	type: "not_speaking";
}

export interface Init {
	type: "init";

	// Receive audio directly from the worklet (in chunks of 128 samples).
	// TODO strongly type this.
	capture: MessagePort;

	// Forward any speaking audio (in chunks of 512 samples) to a captions worker.
	// TODO strongly type this.
	captions?: MessagePort;
}

export type Response = Result | Error;

export interface Result {
	type: "result";
	speaking: boolean;
}

export interface Error {
	type: "error";
	message: string;
}

const SAMPLE_RATE = 16000;
const CHUNK_SIZE = 512; // This VAD model expects 512 samples at a time.

const model = await AutoModel.from_pretrained("onnx-community/silero-vad", {
	// @ts-expect-error Not sure why this is needed.
	config: { model_type: "custom" },
	dtype: "fp32", // Full-precision
});

// Initial state for VAD
let state = new Tensor("float32", new Float32Array(2 * 1 * 128), [2, 1, 128]);
let speaking = false;
let captions: MessagePort | undefined;

// We use two buffers, one to store the most recent chunk and one to store the previous chunk.
// When a speaking event starts, we transmit the previous chunk and the current chunk.
// This gives the captions worker a little bit of padding and context to start transcribing.
// The same thing happens when a speaking event ends, we transmit the current non-speaking chunk.
let current = new Float32Array(new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * CHUNK_SIZE), 0, 0);
let previous = new Float32Array(new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * CHUNK_SIZE), 0, 0);

async function process(samples: Float32Array) {
	// Copy over samples to the buffer.
	current = new Float32Array(current.buffer, 0, current.length + samples.length);
	current.set(samples, current.length - samples.length);

	// NOTE: This assumes that the worklet posts 128 samples at a time.
	// Since 512 is evenly divisible by 128, we don't have to worry about remaining samples.
	if (current.byteLength < current.buffer.byteLength) {
		return;
	}

	// Create a tensor for the model.
	const sr = new Tensor("int64", [SAMPLE_RATE], []);
	const input = new Tensor("float32", current, [1, current.length]);

	const result = await model({ input, sr, state });
	state = result.stateN;
	const isSpeech = result.output.data[0];

	const wasSpeaking = speaking;

	if (wasSpeaking && isSpeech < 0.1) {
		// No longer speaking.
		speaking = false;

		const response: Response = {
			type: "result",
			speaking: false,
		};
		self.postMessage(response);
	} else if (!speaking && isSpeech >= 0.3) {
		// Now speaking.
		speaking = true;

		const response: Response = {
			type: "result",
			speaking: true,
		};
		self.postMessage(response);
	}

	if (captions && (speaking || wasSpeaking)) {
		if (!wasSpeaking) {
			// Transmit the previous chunk.
			captions.postMessage({
				type: "speaking",
				samples: previous, // NOTE: makes a copy
				padding: "start",
			});
		}

		// Forward the speaking audio to the captions worker.
		captions.postMessage({
			type: "speaking",
			samples: current, // NOTE: makes a copy
			padding: !speaking ? "end" : undefined,
		});
	}

	// Swap the buffers, avoiding a reallocation.
	const temp = previous.buffer;
	previous = current;
	current = new Float32Array(temp, 0, 0);
}

self.addEventListener("message", async (event: MessageEvent<Message>) => {
	const message = event.data;

	try {
		captions = message.captions;

		// Only one message currently supported.
		message.capture.onmessage = ({ data: { channels } }: { data: Worklet.AudioFrame }) => {
			process(channels[0]);
		};
	} catch (error) {
		const response: Response = {
			type: "error",
			message: error instanceof Error ? error.message : "Unknown error",
		};
		self.postMessage(response);
	}
});
