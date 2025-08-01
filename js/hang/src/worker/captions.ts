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

const model = await pipeline(
	"automatic-speech-recognition",
	"onnx-community/whisper-base", // or "onnx-community/moonshine-base-ONNX",
	{
		device: "webgpu",
		dtype: {
			encoder_model: "fp32",
			decoder_model_merged: "fp32",
		},
	},
).catch((error) => {
	self.postMessage({ error });
	throw error;
});

await model(new Float32Array(SAMPLE_RATE)); // Compile shaders

const MAX_BUFFER = 15 * SAMPLE_RATE; // 15 seconds

// Allocate the maximum buffer size.
let buffer = new Float32Array(new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * MAX_BUFFER * SAMPLE_RATE), 0, 0);

// Add samples to the buffer if there's space.
function queue(samples: Float32Array): boolean {
	if (buffer.byteLength + samples.byteLength > buffer.buffer.byteLength) return false;

	const newBuffer = new Float32Array(buffer.buffer, 0, buffer.length + samples.length);
	newBuffer.set(samples, buffer.length - samples.length);
	buffer = newBuffer;

	return true;
}

async function process() {
	if (buffer.byteLength === 0) return;

	const result = await model(buffer);
	buffer = new Float32Array(buffer.buffer, 0, 0); // reset the buffer
	console.log(result);

	if (Array.isArray(result)) {
		throw new Error("Expected a single result, got an array");
	}

	if (["", "[BLANK_AUDIO]"].includes(result.text)) {
		// transcription is empty or blank audio
		return;
	}

	const response: Response = {
		type: "result",
		text: result.text,
	};
	self.postMessage(response);

	// Reset the buffer back to zero.
	buffer = new Float32Array(buffer.buffer, 0, 0);
}

self.addEventListener("message", async (event: MessageEvent<Message>) => {
	const message = event.data;

	try {
		// Only one message currently supported.
		message.vad.onmessage = async ({ data: { samples, padding } }: { data: VAD.Speaking }) => {
			if (!queue(samples)) {
				// The buffer is full, process the audio and reset the buffer.
				await process();

				// Now there will be space in the buffer.
				queue(samples);
			}

			if (padding === "end") {
				await process();
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
