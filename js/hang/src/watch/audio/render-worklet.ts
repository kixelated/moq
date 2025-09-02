import type { Message } from "./render";
import { AudioRingBuffer } from "./ring-buffer";

class Render extends AudioWorkletProcessor {
	#buffer?: AudioRingBuffer;
	#underflow = 0;

	constructor() {
		super();

		// Listen for audio data from main thread
		this.port.onmessage = (event: MessageEvent<Message>) => {
			const { type } = event.data;
			if (type === "init") {
				console.debug(`init: ${event.data.latency}`);
				this.#buffer = new AudioRingBuffer(event.data);
				this.#underflow = 0;
			} else if (type === "data") {
				if (!this.#buffer) throw new Error("buffer not initialized");
				this.#buffer.write(event.data.timestamp, event.data.data);
			} else {
				const exhaustive: never = type;
				throw new Error(`unknown message type: ${exhaustive}`);
			}
		};
	}

	process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>) {
		const output = outputs[0];
		const samplesRead = this.#buffer?.read(output) ?? 0;

		if (samplesRead < output[0].length) {
			this.#underflow += output[0].length - samplesRead;
		} else if (this.#underflow > 0 && this.#buffer) {
			console.warn(`audio underflow: ${Math.round((1000 * this.#underflow) / this.#buffer.sampleRate)}ms`);
			this.#underflow = 0;
		}

		return true;
	}
}

registerProcessor("render", Render);
