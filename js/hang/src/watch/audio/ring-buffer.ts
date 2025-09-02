import * as Time from "../../time";

export class AudioRingBuffer {
	#buffer: Float32Array[];
	#writeIndex = 0;
	#readIndex = 0;

	readonly sampleRate: number;
	readonly channels: number;
	#refill = true;

	constructor(props: { sampleRate: number; channelCount: number; latency: Time.Micro }) {
		if (props.channelCount === 0) throw new Error("invalid channels");
		if (props.sampleRate === 0) throw new Error("invalid sample rate");
		if (props.latency === 0) throw new Error("invalid latency");

		const samples = Math.ceil(props.sampleRate * Time.Second.fromMicro(props.latency));
		if (samples === 0) throw new Error("empty buffer");

		this.sampleRate = props.sampleRate;
		this.channels = props.channelCount;

		this.#buffer = [];
		for (let i = 0; i < this.channels; i++) {
			this.#buffer[i] = new Float32Array(samples);
		}
	}

	get refilling(): boolean {
		return this.#refill;
	}

	get length(): number {
		return this.#writeIndex - this.#readIndex;
	}

	get capacity(): number {
		return this.#buffer[0]?.length;
	}

	write(timestamp: Time.Micro, data: Float32Array[]): void {
		if (data.length !== this.channels) throw new Error("wrong number of channels");

		let start = Math.round(Time.Second.fromMicro(timestamp) * this.sampleRate);
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
			const gapSize = Math.min(start - this.#writeIndex, this.#buffer[0].length);
			if (gapSize === 1) {
				console.warn("floating point inaccuracy detected");
			}

			for (let channel = 0; channel < this.channels; channel++) {
				const dst = this.#buffer[channel];
				for (let i = 0; i < gapSize; i++) {
					const writePos = (this.#writeIndex + i) % dst.length;
					dst[writePos] = 0;
				}
			}
		}

		// Write the actual samples
		for (let channel = 0; channel < this.channels; channel++) {
			const src = data[channel];
			const dst = this.#buffer[channel];

			for (let i = 0; i < samples; i++) {
				const writePos = (start + i) % dst.length;
				dst[writePos] = src[offset + i];
			}
		}

		// Update write index, but only if we're moving forward
		if (end > this.#writeIndex) {
			this.#writeIndex = end;
		}
	}

	read(output: Float32Array[]): number {
		if (output.length !== this.channels) throw new Error("wrong number of channels");
		if (this.#refill) return 0;

		const samples = Math.min(this.#writeIndex - this.#readIndex, output[0].length);
		if (samples === 0) return 0;

		for (let channel = 0; channel < this.channels; channel++) {
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
}
