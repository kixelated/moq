class Capture extends AudioWorkletProcessor {
	#sampleCount = 0;

	process(input: Float32Array[][]) {
		if (input.length > 1) throw new Error("only one input is supported.");
		const channels = input[0];

		this.port.postMessage({
			timestamp: this.#sampleCount,
			channels,
		});

		this.#sampleCount += channels[0].length;
		return true;
	}
}

registerProcessor("capture", Capture);
