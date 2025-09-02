import { type AutomaticSpeechRecognitionPipeline, pipeline } from "@huggingface/transformers";
import type { AudioFrame } from "./capture";

export type Request = Init | Speaking;

export interface Init {
	type: "init";
	// Captured audio from the worklet.
	worklet: MessagePort;
}

export interface Speaking {
	type: "speaking";
	speaking: boolean;
}

export type Result = Text | Error;

export interface Text {
	type: "text";
	text: string;
}

export interface Error {
	type: "error";
	message: string;
}

const SAMPLE_RATE = 16000;

const MAX_WHISPER_BUFFER = 15 * SAMPLE_RATE; // 15 seconds

class Whisper {
	#queued = new Float32Array(new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * MAX_WHISPER_BUFFER), 0, 0);
	#swap = new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * MAX_WHISPER_BUFFER);

	#processing = false;

	#speaking = false;
	#model: Promise<AutomaticSpeechRecognitionPipeline>;

	constructor() {
		// Start loading the model
		this.#model = pipeline(
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
		).then((model) => {
			// Compile shaders
			model(new Float32Array(SAMPLE_RATE));
			return model;
		});
	}

	write(samples: Float32Array) {
		if (this.#queued.byteLength + samples.length > this.#queued.buffer.byteLength) {
			if (!this.flush()) {
				console.warn("buffer is full, dropping samples");
				return;
			}
		}

		// Determine how many samples to keep.
		// If we're not speaking, only keep the previous chunk.
		// TODO add a constant to keep more.
		const keep = this.#speaking ? this.#queued.length : 0;

		this.#queued = new Float32Array(this.#queued.buffer, 0, keep + samples.length);
		this.#queued.set(samples, this.#queued.length - samples.length);
	}

	flush(): boolean {
		if (this.#processing) {
			return false;
		}

		this.#processing = true;

		const queued = this.#queued;
		this.#queued = new Float32Array(this.#swap, 0, 0);
		this.#swap = queued.buffer;

		this.#flush(queued).finally(() => {
			this.#processing = false;
		});

		return true;
	}

	async #flush(buffer: Float32Array) {
		const model = await this.#model;

		// Do the expensive transcription.
		const result = await model(buffer);
		if (Array.isArray(result)) {
			throw new Error("Expected a single result, got an array");
		}

		const text = result.text.trim();
		if (text === "[BLANK_AUDIO]" || text === "") return;

		postResult({
			type: "text",
			text,
		});
	}

	set speaking(speaking: boolean) {
		if (this.#speaking === speaking) return;

		this.#speaking = speaking;

		if (!speaking) {
			this.flush();
		}
	}
}

const whisper = new Whisper();

self.addEventListener("message", async (event: MessageEvent<Request>) => {
	const message = event.data;

	if (message.type === "init") {
		message.worklet.onmessage = ({ data: { channels } }: MessageEvent<AudioFrame>) => {
			whisper.write(channels[0]);
		};
	} else if (message.type === "speaking") {
		whisper.speaking = message.speaking;
	}
});

function postResult(msg: Result) {
	self.postMessage(msg);
}
