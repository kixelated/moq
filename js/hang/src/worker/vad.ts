import { AutoModel, Tensor } from "@huggingface/transformers";
import type * as Worklet from "../worklet";

export type Message = Init;

export interface Init {
	type: "init";
	worklet: MessagePort;
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

const sampleRate = 16000;

const model = await AutoModel.from_pretrained("onnx-community/silero-vad", {
	// @ts-expect-error Not sure why this is needed.
	config: { model_type: "custom" },
	dtype: "fp32", // Full-precision
});

// Initial state for VAD
let state = new Tensor("float32", new Float32Array(2 * 1 * 128), [2, 1, 128]);
let buffer = new Float32Array(new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 512), 0, 0);
let speaking = false;

async function process(samples: Float32Array) {
	// Copy over samples to the buffer.
	buffer = new Float32Array(buffer.buffer, 0, buffer.length + samples.length);
	buffer.set(samples, buffer.length - samples.length);

	// NOTE: This assumes that the worklet posts 128 samples at a time.
	// Since 512 is evenly divisible by 128, we don't have to worry about remaining samples.
	if (buffer.byteLength < buffer.buffer.byteLength) {
		return;
	}

	// Create a tensor for the model.
	const sr = new Tensor("int64", [sampleRate], []);
	const input = new Tensor("float32", buffer, [1, buffer.length]);

	let isSpeech: number;
	try {
		const result = await model({ input, sr, state });
		state = result.stateN;
		isSpeech = result.output.data[0];
	} finally {
		// Reset the buffer.
		buffer = new Float32Array(buffer.buffer, 0, 0);
	}

	if (speaking) {
		if (isSpeech >= 0.1) return;
		// No longer speaking.
		speaking = false;
	} else {
		if (isSpeech < 0.3) return;
		// Now speaking.
		speaking = true;
	}

	const response: Response = {
		type: "result",
		speaking,
	};
	self.postMessage(response);
}

self.addEventListener("message", async (event: MessageEvent<Message>) => {
	const message = event.data;

	try {
		// Only one message currently supported.
		message.worklet.onmessage = ({ data: { channels } }: { data: Worklet.AudioFrame }) => {
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
