import type { Status } from "./render";

export class AudioRingBuffer {
	#buffer: Float32Array[] = [];
	#writeIndex = 0;
	#readIndex = 0;
	#sampleRate = 0;
	#refill = true;

	get refilling(): boolean {
		return this.#refill;
	}

	get length(): number {
		return this.#writeIndex - this.#readIndex;
	}

	get capacity(): number {
		return this.#buffer[0]?.length ?? 0;
	}

	get utilization(): number {
		if (this.capacity === 0) return 0;
		return this.length / this.capacity;
	}

	initialize(props: { sampleRate: number; channelCount: number; latency: number }): void {
		if (props.channelCount === 0) throw new Error("invalid channels");
		if (props.sampleRate === 0) throw new Error("invalid sample rate");
		if (props.latency === 0) throw new Error("invalid latency");
		if (this.#buffer.length > 0) throw new Error("already initialized");

		const samples = Math.ceil((props.sampleRate * props.latency) / 1000);
		this.#sampleRate = props.sampleRate;

		this.#buffer = [];
		for (let i = 0; i < props.channelCount; i++) {
			this.#buffer[i] = new Float32Array(samples);
		}
	}

	write(timestamp: number, data: Float32Array[]): void {
		if (this.#buffer.length === 0) throw new Error("not initialized");

		let start = Math.round(timestamp * this.#sampleRate);
		let samples = data[0].length;

		// Ignore samples that are too old (before the read index)
		let offset = this.#readIndex - start;
		if (offset > samples) {
			// All samples are too old, ignore them
			return;
		} else if (offset > 0) {
			// Some samples are too old, skip them
			samples -= offset;
			start += offset;
		} else {
			offset = 0;
		}

		const end = start + samples;

		// Check if we need to discard old samples to prevent overflow
		const overflow = end - this.#readIndex - this.#buffer[0].length;
		if (overflow > 0) {
			// Exit refill mode when we have enough data
			this.#refill = false;
			// Discard old samples
			this.#readIndex = end - this.#buffer[0].length;
		}

		// Fill gaps with zeros if there's a discontinuity
		if (start > this.#writeIndex) {
			const gapSize = start - this.#writeIndex;
			for (let channel = 0; channel < this.#buffer.length; channel++) {
				const dst = this.#buffer[channel];
				for (let i = 0; i < gapSize; i++) {
					const writePos = (this.#writeIndex + i) % dst.length;
					dst[writePos] = 0;
				}
			}
		}

		// Write the actual samples
		for (let channel = 0; channel < Math.min(this.#buffer.length, data.length); channel++) {
			const src = data[channel];
			const dst = this.#buffer[channel];

			for (let i = 0; i < samples; i++) {
				const writePos = (start + i) % dst.length;
				dst[writePos] = src[offset + i];
			}
		}

		// Handle missing channels (e.g., mono data in stereo buffer)
		for (let channel = data.length; channel < this.#buffer.length; channel++) {
			const dst = this.#buffer[channel];
			for (let i = 0; i < samples; i++) {
				const writePos = (start + i) % dst.length;
				dst[writePos] = 0;
			}
		}

		// Update write index, but only if we're moving forward
		if (end > this.#writeIndex) {
			this.#writeIndex = end;
		}
	}

	read(output: Float32Array[]): number {
		if (this.#buffer.length === 0 || output.length === 0) return 0;
		if (this.#refill) return 0;

		const samples = Math.min(this.#writeIndex - this.#readIndex, output[0].length);
		if (samples === 0) return 0;

		for (let channel = 0; channel < output.length; channel++) {
			const dst = output[channel];
			const src = this.#buffer[channel];

			for (let i = 0; i < samples; i++) {
				const readPos = (this.#readIndex + i) % src.length;
				dst[i] = src[readPos];
			}
		}

		this.#readIndex += samples;
		return samples;
	}

	status(): Status {
		return {
			type: "status",
			available: this.length,
			utilization: this.utilization,
		};
	}
}
