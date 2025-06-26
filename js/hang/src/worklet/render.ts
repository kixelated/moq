import type { Data, Init, Message, Status } from ".";

class Render extends AudioWorkletProcessor {
	#buffer: Float32Array[] = [];

	#writeIndex = 0;
	#readIndex = 0;

	// Wait for the buffer to be refilled before outputting.
	#refill = true;

	constructor() {
		super();

		// Listen for audio data from main thread
		this.port.onmessage = (event: MessageEvent<Message>) => {
			const { type } = event.data;
			if (type === "init") {
				this.#handleInit(event.data);
			} else if (type === "data") {
				this.#handleData(event.data);
			} else {
				const exhaustive: never = type;
				throw new Error(`unknown message type: ${exhaustive}`);
			}
		};
	}

	#handleInit(init: Init) {
		// Sanity checks
		if (init.channelCount === 0) throw new Error("invalid channels");
		if (init.sampleRate === 0) throw new Error("invalid sample rate");
		if (init.latency === 0) throw new Error("invalid latency");

		if (this.#buffer.length > 0) return; // Already initialized

		const samples = Math.ceil((init.sampleRate * init.latency) / 1000);

		// Initialize circular buffer for each channel
		this.#buffer = [];
		for (let i = 0; i < init.channelCount; i++) {
			this.#buffer[i] = new Float32Array(samples);
		}
	}

	#handleData(sample: Data) {
		if (this.#buffer.length === 0) throw new Error("not initialized");

		const samples = sample.data[0].length;

		// Discard old samples from the front to prevent an overflow.
		const discard = this.#writeIndex - this.#readIndex + samples - this.#buffer[0].length;
		if (discard >= 0) {
			this.#refill = false;
			this.#readIndex += discard;
		}

		// Write new samples to buffer
		for (let channel = 0; channel < Math.min(this.#buffer.length, sample.data.length); channel++) {
			const src = sample.data[channel];
			const dst = this.#buffer[channel];

			for (let i = 0; i < samples; i++) {
				const writePos = (this.#writeIndex + i) % dst.length;
				dst[writePos] = src[i];
			}
		}

		this.#writeIndex += samples;
	}

	#advance(samples: number) {
		this.#readIndex += samples;

		if (this.#readIndex >= this.#buffer[0].length) {
			this.#readIndex -= this.#buffer[0].length;
			this.#writeIndex -= this.#buffer[0].length;
		}
	}

	process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>) {
		const output = outputs[0];

		// Not initialized yet, output silence
		if (this.#buffer.length === 0 || output.length === 0) return true;
		if (this.#refill) return true;

		// No data available, output silence
		const samples = Math.min(this.#writeIndex - this.#readIndex, output[0].length);
		if (samples === 0) return true;

		for (let channel = 0; channel < output.length; channel++) {
			const dst = output[channel];
			const src = this.#buffer[channel];

			for (let i = 0; i < samples; i++) {
				const readPos = (this.#readIndex + i) % src.length;
				dst[i] = src[readPos];
			}
		}

		this.#advance(samples);

		// Send buffer status back to main thread for monitoring
		this.post({
			type: "status",
			available: this.#writeIndex - this.#readIndex,
			utilization: (this.#writeIndex - this.#readIndex) / this.#buffer[0].length,
		});

		return true;
	}

	private post(status: Status) {
		this.port.postMessage(status);
	}
}

registerProcessor("render", Render);
