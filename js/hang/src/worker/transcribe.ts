import { pipeline } from "@huggingface/transformers";
import type * as VAD from "./vad";

export type Message = Init;

export interface Init {
	type: "init";

	// Receive "speaking" audio directly from the VAD worker.
	// TODO strongly type this, receives Speaking and NotSpeaking.
	vad: MessagePort;
}

export type Response = Result | Error;

export interface Result {
	type: "result";
	text: string;
}

export interface Error {
	type: "error";
	message: string;
}

const SAMPLE_RATE = 16000;
const MAX_BUFFER = 15 * SAMPLE_RATE; // 15 seconds

const queue = new TransformStream<Float32Array, Float32Array>(
	undefined,
	{
		highWaterMark: MAX_BUFFER,
		size: (chunk) => chunk.length,
	},
	{
		highWaterMark: MAX_BUFFER,
		size: (chunk) => chunk.length,
	},
);

const writer = queue.writable.getWriter();
const reader = queue.readable.getReader();

self.addEventListener("message", async (event: MessageEvent<Message>) => {
	const message = event.data;

	try {
		// Only one message currently supported.
		message.vad.onmessage = ({ data: { samples, padding } }: { data: VAD.Speaking }) => {
			if ((writer.desiredSize ?? 0) < samples.length) {
				// The queue is full, drop the samples.
				return;
			}

			writer.write(samples);

			if (padding === "end") {
				// Kind of a hacky way to force a flush.
				writer.write(new Float32Array());
			}
		};
	} catch (error) {
		const response: Response = {
			type: "error",
			message: error instanceof Error ? error.message : "Unknown error",
		};
		self.postMessage(response);
	}
});

async function run() {
	// Start loading the model
	const model = await pipeline(
		"automatic-speech-recognition",
		// "onnx-community/moonshine-base-ONNX",
		"onnx-community/whisper-base.en",
		{
			device: "webgpu",
			dtype: {
				encoder_model: "fp32",
				decoder_model_merged: "fp32",
			},
		},
	);
	// Compile shaders
	await model(new Float32Array(SAMPLE_RATE));

	// Allocate the maximum buffer size.
	let buffer = new Float32Array(new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * MAX_BUFFER), 0, 0);

	for (;;) {
		const { value: samples } = await reader.read();
		if (!samples) break;

		if (samples.byteLength > 0 && buffer.byteLength + samples.byteLength < buffer.buffer.byteLength) {
			// Copy over samples to the buffer.
			buffer = new Float32Array(buffer.buffer, 0, buffer.length + samples.length);
			buffer.set(samples, buffer.length - samples.length);
			continue;
		}

		if (samples.byteLength !== 0) {
			console.warn("buffer is full; flushing");
		}

		// Do the expensive transcription.
		const result = await model(buffer);
		if (Array.isArray(result)) {
			throw new Error("Expected a single result, got an array");
		}

		let text = result.text.trim();
		if (text === "[BLANK_AUDIO]") text = "";

		const response: Response = {
			type: "result",
			text,
		};
		self.postMessage(response);

		buffer = new Float32Array(buffer.buffer, 0, samples.length); // reset the buffer, saving the left over samples.
		buffer.set(samples, 0);
	}
}

run()
	.catch((error) => {
		self.postMessage({ error });
		throw error;
	})
	.finally(() => {
		reader.cancel();
	});
