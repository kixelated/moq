import { AutoModel, type PreTrainedModel, Tensor } from "@huggingface/transformers";
import type { AudioFrame } from "./capture";

export type Request = Init;

export interface Init {
	type: "init";
	// Captured audio from the worklet.
	worklet: MessagePort;
}

export type Result = Speaking | Error;

export interface Speaking {
	type: "speaking";
	speaking: boolean;
}

export interface Error {
	type: "error";
	message: string;
}

const SAMPLE_RATE = 16000;

// This VAD model expects 512 samples at a time, or 31ms
const VAD_CHUNK_SIZE = 512;

// Require 8 silence chunks to be detected before we consider the user done speaking.
const VAD_SILENCE_PADDING = 8;

class Vad {
	// Simple circular buffer, primarily so we keep the previous buffer around once speaking is detected.
	#next = new Float32Array(new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * VAD_CHUNK_SIZE), 0, 0); // queued
	#current = new Float32Array(new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * VAD_CHUNK_SIZE), 0, 0); // being processed
	#prev = new Float32Array(new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * VAD_CHUNK_SIZE), 0, 0); // already processed

	#processing = false;

	// Initial state for VAD
	#sr = new Tensor("int64", [SAMPLE_RATE], []);
	#state = new Tensor("float32", new Float32Array(2 * 1 * 128), [2, 1, 128]);
	#speaking = false;

	// Count the number of silence results, if we get 3 in a row then we're done.
	#silence = 0;

	#model: Promise<PreTrainedModel>;

	constructor() {
		this.#model = AutoModel.from_pretrained("onnx-community/silero-vad", {
			// @ts-expect-error Not sure why this is needed.
			config: { model_type: "custom" },
			dtype: "fp32", // Full-precision
		});
	}

	write(samples: Float32Array) {
		if (this.#next.byteLength >= this.#next.buffer.byteLength) {
			if (!this.flush()) {
				// Drop the sample if VAD is still processing.
				return;
			}
		}

		this.#next = new Float32Array(this.#next.buffer, 0, this.#next.length + samples.length);
		this.#next.set(samples, this.#next.length - samples.length);

		if (this.#next.byteLength === this.#next.buffer.byteLength) {
			this.flush(); // don't care if it fails
		}
	}

	flush(): boolean {
		if (this.#processing) {
			return false;
		}

		this.#processing = true;

		this.#current = this.#next;
		this.#next = new Float32Array(this.#prev.buffer, 0, 0);
		this.#prev = this.#current;

		this.#flush().finally(() => {
			this.#processing = false;
		});

		return true;
	}

	async #flush() {
		const model = await this.#model;

		const input = new Tensor("float32", this.#current, [1, this.#current.length]);
		const result = await model({ input, sr: this.#sr, state: this.#state });
		this.#state = result.stateN;

		const isSpeech = result.output.data[0];
		if (this.#speaking && isSpeech < 0.3) {
			this.#silence++;

			if (this.#silence > VAD_SILENCE_PADDING) {
				this.#speaking = false;

				postResult({
					type: "speaking",
					speaking: false,
				});
			}
		} else if (!this.#speaking && isSpeech >= 0.1) {
			this.#speaking = true;
			this.#silence = 0;

			postResult({
				type: "speaking",
				speaking: true,
			});
		}
	}
}

self.addEventListener("message", async (event: MessageEvent<Request>) => {
	const message = event.data;

	const vad = new Vad();
	message.worklet.onmessage = ({ data: { channels } }: MessageEvent<AudioFrame>) => {
		vad.write(channels[0]);
	};
});

function postResult(msg: Result) {
	self.postMessage(msg);
}
