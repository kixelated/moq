import type { Message, Status } from "./render";
import { AudioRingBuffer } from "./ring-buffer";

class Render extends AudioWorkletProcessor {
	#buffer = new AudioRingBuffer();

	constructor() {
		super();

		// Listen for audio data from main thread
		this.port.onmessage = (event: MessageEvent<Message>) => {
			const { type } = event.data;
			if (type === "init") {
				this.#buffer.initialize(event.data);
			} else if (type === "data") {
				this.#buffer.write(event.data.timestamp, event.data.data);
			} else {
				const exhaustive: never = type;
				throw new Error(`unknown message type: ${exhaustive}`);
			}
		};
	}

	process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>) {
		const output = outputs[0];
		const samplesRead = this.#buffer.read(output);

		// Send buffer status back to main thread for monitoring
		if (samplesRead > 0) {
			this.post(this.#buffer.status());
		}

		return true;
	}

	private post(status: Status) {
		this.port.postMessage(status);
	}
}

registerProcessor("render", Render);
