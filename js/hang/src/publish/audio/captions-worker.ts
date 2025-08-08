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

const VAD_CHUNK_SIZE = 512; // This VAD model expects 512 samples at a time, or 31ms

class Vad {
	whisper: Whisper;

	#queued = new Float32Array(new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * VAD_CHUNK_SIZE), 0, 0);
	#swap = new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * VAD_CHUNK_SIZE);
	#processing = false;

	// Initial state for VAD
	#sr = new Tensor("int64", [SAMPLE_RATE], []);
	#state = new Tensor("float32", new Float32Array(2 * 1 * 128), [2, 1, 128]);
	#speaking = false;

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

		const result = await model({ input: buffer, sr: this.#sr, state: this.#state });
		this.#state = result.stateN;

		const wasSpeaking = this.#speaking;

		const isSpeech = result.output.data[0];
		if (this.#speaking && isSpeech < 0.3) {
			this.#speaking = false;

			postResult({
				type: "speaking",
				speaking: false,
			});
		} else if (!this.#speaking && isSpeech >= 0.1) {
			this.#speaking = true;

			postResult({
				type: "speaking",
				speaking: true,
			});
		}

		if (wasSpeaking || this.#speaking) {
			this.whisper.write(buffer);
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

		let text = result.text.trim();
		if (text === "[BLANK_AUDIO]") text = "";

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
