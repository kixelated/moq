class Capture extends AudioWorkletProcessor {
	process(input: Float32Array[][]) {
		if (input.length > 1) throw new Error("only one input is supported.");

		const channels = input[0];
		if (channels.length === 0) return true; // TODO: No input hooked up?
		if (channels.length !== 1) throw new Error("only one channel is supported.");

		this.port.postMessage(channels[0]);
		return true;
	}
}

registerProcessor("captions", Capture);
