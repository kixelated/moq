import {
	AutoModel,
	type AutomaticSpeechRecognitionPipeline,
	type PreTrainedModel,
	pipeline,
	Tensor,
} from "@huggingface/transformers";

export type Request = Init;

export interface Init {
	type: "init";

	// Receive "speaking" audio directly from the VAD worker.
	// TODO strongly type this, receives Speaking and NotSpeaking.
	worklet: MessagePort;
}

export type Result = Speaking | Text | Error;

export interface Speaking {
	type: "speaking";
	speaking: boolean;
}

export interface Text {
	type: "text";
	text: string;
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
	whisper: Whisper;

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

	constructor(whisper: Whisper) {
		this.whisper = whisper;

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

		const wasSpeaking = this.#speaking;

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

		if (!wasSpeaking && this.#speaking) {
			this.whisper.write(this.#prev);
		}

		if (wasSpeaking || this.#speaking) {
			this.whisper.write(this.#current);
		}

		if (wasSpeaking && !this.#speaking) {
			this.whisper.flush();
		}
	}
}

const MAX_WHISPER_BUFFER = 15 * SAMPLE_RATE; // 15 seconds

class Whisper {
	#queued = new Float32Array(new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * MAX_WHISPER_BUFFER), 0, 0);
	#swap = new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * MAX_WHISPER_BUFFER);

	#processing = false;

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

		this.#queued = new Float32Array(this.#queued.buffer, 0, this.#queued.length + samples.length);
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
}

self.addEventListener("message", async (event: MessageEvent<Request>) => {
	const message = event.data;
	const whisper = new Whisper();
	const vad = new Vad(whisper);

	message.worklet.onmessage = ({ data: samples }: MessageEvent<Float32Array>) => {
		vad.write(samples);
	};
});

function postResult(msg: Result) {
	self.postMessage(msg);
}
