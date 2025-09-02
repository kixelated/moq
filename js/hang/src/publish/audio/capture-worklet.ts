import type * as Time from "../../time";
import type { AudioFrame } from "./capture";

class Capture extends AudioWorkletProcessor {
	#sampleCount = 0;

	process(input: Float32Array[][]) {
		if (input.length > 1) throw new Error("only one input is supported.");

		const channels = input[0];
		if (channels.length === 0) return true; // TODO: No input hooked up?

		// Convert sample count to milliseconds
		const timestampMs = ((1000 * this.#sampleCount) / sampleRate) as Time.Milli;

		const msg: AudioFrame = {
			timestamp: timestampMs,
			channels,
		};

		this.port.postMessage(msg);

		this.#sampleCount += channels[0].length;
		return true;
	}
}

registerProcessor("capture", Capture);
