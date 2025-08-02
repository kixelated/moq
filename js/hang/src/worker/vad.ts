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
	worklet: MessagePort;

	// Forward any speaking audio (in chunks of 512 samples) to a transcribe worker.
	// TODO strongly type this.
	transcribe?: MessagePort;
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
const CHUNK_SIZE = 512; // This VAD model expects 512 samples at a time, or 31ms

// Require this many silent chunks in a row before unsetting speaking.
const SILENT_CHUNKS = 8;

// Create a queue to store audio chunks that arrive asynchronously.
const queue = new TransformStream<Float32Array, Float32Array>(
	undefined,
	{
		highWaterMark: CHUNK_SIZE,
		size: (chunk) => chunk.length,
	},
	{
		highWaterMark: CHUNK_SIZE,
		size: (chunk) => chunk.length,
	},
);

const writer = queue.writable.getWriter();

// Post any speaking audio to the transcribe worker.
let transcribe: MessagePort | undefined;

self.addEventListener("message", async (event: MessageEvent<Message>) => {
	const message = event.data;

	try {
		transcribe = message.transcribe;

		message.worklet.onmessage = ({ data: { channels } }: { data: Worklet.AudioFrame }) => {
			const samples = channels[0];

			if ((writer.desiredSize ?? 0) < samples.length) {
				// The queue is full, drop the samples.
				return;
			}

			writer.write(samples);
		};
	} catch (error) {
		const response: Response = {
			type: "error",
			message: error instanceof Error ? error.message : "Unknown error",
		};
		self.postMessage(response);
	}
});

const reader = queue.readable.getReader();
try {
	const model = await AutoModel.from_pretrained("onnx-community/silero-vad", {
		// @ts-expect-error Not sure why this is needed.
		config: { model_type: "custom" },
		dtype: "fp32", // Full-precision
	});

	// Initial state for VAD
	const sr = new Tensor("int64", [SAMPLE_RATE], []);
	let state = new Tensor("float32", new Float32Array(2 * 1 * 128), [2, 1, 128]);

	// We use multiple buffers to add gaps between speaking events and to avoid reallocating memory.
	let current = new Float32Array(new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * CHUNK_SIZE), 0, 0);
	let previous = new Float32Array(new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * CHUNK_SIZE), 0, 0);

	// Whether we (think) we are currently speaking.
	let speaking = false;

	// Count the number of silent chunks, eventually unsetting speaking once it reaches
	let silentCount = 0;

	for (;;) {
		const { value: samples } = await reader.read();
		if (!samples) {
			break;
		}

		// Copy over samples to the buffer.
		current = new Float32Array(current.buffer, 0, current.length + samples.length);
		current.set(samples, current.length - samples.length);

		// NOTE: This assumes that the worklet posts 128 samples at a time.
		// Since 512 is evenly divisible by 128, we don't have to worry about remaining samples.
		if (current.byteLength < current.buffer.byteLength) {
			continue;
		}

		// Create a tensor for the model.
		const input = new Tensor("float32", current, [1, current.length]);

		// Wait for the model to be loaded.
		const vad = model;

		const result = await vad({ input, sr, state });
		state = result.stateN;
		const isSpeech = result.output.data[0];

		const wasSpeaking = speaking;
		if (isSpeech < 0.1 || (!wasSpeaking && isSpeech < 0.3)) {
			silentCount++;
		} else {
			silentCount = 0;
		}

		if (wasSpeaking && silentCount >= SILENT_CHUNKS) {
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
			silentCount = 0;

			const response: Response = {
				type: "result",
				speaking: true,
			};
			self.postMessage(response);
		}

		if (transcribe && (speaking || wasSpeaking)) {
			if (!wasSpeaking) {
				// Transmit the previous chunk.
				transcribe.postMessage({
					type: "speaking",
					samples: previous, // NOTE: makes a copy
					padding: "start",
				});
			}

			// Forward the speaking audio to the transcribe worker.
			transcribe.postMessage({
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
} catch (error) {
	self.postMessage({ error });
	throw error;
} finally {
	reader.cancel();
}
