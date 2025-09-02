import assert from "node:assert";
import test from "node:test";
import * as Time from "../../time";
import { AudioRingBuffer } from "./ring-buffer";

function read(buffer: AudioRingBuffer, samples: number, channelCount = 2): Float32Array[] {
	const output: Float32Array[] = [];
	for (let i = 0; i < channelCount; i++) {
		output.push(new Float32Array(samples));
	}
	const samplesRead = buffer.read(output);
	return output.slice(0, samplesRead);
}

function write(buffer: AudioRingBuffer, timestamp: Time.Milli, samples: number, props?: { channels?: number, value?: number }): void {
	const data: Float32Array[] = [];
	for (let i = 0; i < (props?.channels ?? 2); i++) {
		const channel = new Float32Array(samples);
		channel.fill(props?.value ?? 1.0);
		data.push(channel);
	}
	buffer.write(Time.Micro.fromMilli(timestamp), data);
}

test("initialization", async (t) => {
	await t.test("should initialize with valid parameters", () => {
		const buffer = new AudioRingBuffer({ rate: 48000, channels: 2, latency: 100 as Time.Milli });

		assert.strictEqual(buffer.capacity, 4800); // 48000 * 0.1
		assert.strictEqual(buffer.length, 0);
	});

	await t.test("should throw on invalid channel count", () => {
		assert.throws(
			() => new AudioRingBuffer({ rate: 48000, channels: 0, latency: 100 as Time.Milli }),
			/invalid channels/,
		);
	});

	await t.test("should throw on invalid sample rate", () => {
		assert.throws(
			() => new AudioRingBuffer({ rate: 0, channels: 2, latency: 100 as Time.Milli }),
			/invalid sample rate/,
		);
	});

	await t.test("should throw on invalid latency", () => {
		assert.throws(
			() => new AudioRingBuffer({ rate: 48000, channels: 2, latency: 0 as Time.Milli }),
			/invalid latency/,
		);
	});
});

test("writing data", async (t) => {
	await t.test("should write continuous data", () => {
		const buffer = new AudioRingBuffer({ rate: 1000, channels: 2, latency: 100 as Time.Milli });

		// Write 10 samples at timestamp 0
		write(buffer, 0 as Time.Milli, 10, { channels: 2, value: 1.0 });
		assert.strictEqual(buffer.length, 10);

		// Write 10 more samples at timestamp 10ms
		write(buffer, 10 as Time.Milli, 10, { channels: 2, value: 2.0 });
		assert.strictEqual(buffer.length, 20);
	});

	await t.test("should handle gaps by filling with zeros", () => {
		const buffer = new AudioRingBuffer({ rate: 1000, channels: 2, latency: 100 as Time.Milli }); // 100 samples buffer

		// Write at timestamp 0
		write(buffer, 0 as Time.Milli, 10, { channels: 2, value: 1.0 });

		// Write at timestamp 0.02 (20ms), creating a 10 sample gap
		write(buffer, 20 as Time.Milli, 10, { channels: 2, value: 2.0 });

		// Should have filled the gap with zeros
		assert.strictEqual(buffer.length, 30); // 10 + 10 (gap) + 10
	});

	await t.test("should handle late-arriving samples", () => {
		const buffer = new AudioRingBuffer({ rate: 1000, channels: 1, latency: 100 as Time.Milli });

		// Fill buffer to exit refill mode
		write(buffer, 0 as Time.Milli, 100, { channels: 1, value: 0.0 });
		write(buffer, 10 as Time.Milli, 10, { channels: 1, value: 0.0 }); // This exits refill mode

		// Clear the buffer
		read(buffer, 110, 1);

		// Write at timestamp 0.12 (120ms) - creates a gap
		write(buffer, 12 as Time.Milli, 10, { channels: 1, value: 1.0 });

		// Now write data that fills the gap at timestamp 0.11 (110ms)
		write(buffer, 11 as Time.Milli, 10, { channels: 1, value: 2.0 });

		// Read and verify both writes are present
		const output = read(buffer, 20, 1);
		assert.strictEqual(output.length, 20);

		// First 10 samples should be 2.0 (the late-arriving data)
		for (let i = 0; i < 10; i++) {
			assert.strictEqual(output[0][i], 2.0);
		}
		// Next 10 samples should be 1.0
		for (let i = 10; i < 20; i++) {
			assert.strictEqual(output[0][i], 1.0);
		}
	});

	await t.test("should discard samples that are too old", () => {
		const buffer = new AudioRingBuffer({ rate: 1000, channels: 2, latency: 100 as Time.Milli });

		// Exit refill mode first
		write(buffer, 0 as Time.Milli, 100, { channels: 2, value: 0.0 });
		write(buffer, 10 as Time.Milli, 10, { channels: 2, value: 0.0 }); // This exits refill mode

		// Write 50 samples
		write(buffer, 11 as Time.Milli, 50, { channels: 2, value: 1.0 });
		read(buffer, 10, 2); // Read 10 samples, readIndex now at 120

		// Try to write data that's before the read index (at sample 110, which is before 120)
		write(buffer, 11 as Time.Milli, 5, { channels: 2, value: 2.0 }); // These should be ignored

		// Available should be 40 (50 - 10 read)
		assert.strictEqual(buffer.length, 40);
	});

	await t.test("should throw when writing to uninitialized buffer", () => {
		const buffer = new AudioRingBuffer({ rate: 1000, channels: 2, latency: 100 as Time.Milli });
		assert.throws(() => write(buffer, 0 as Time.Milli, 10, { channels: 2, value: 0.0 }), /not initialized/);
	});
});

test("reading data", async (t) => {
	await t.test("should read available data", () => {
		const buffer = new AudioRingBuffer({ rate: 1000, channels: 2, latency: 100 as Time.Milli });

		// Exit refill mode first
		write(buffer, 0 as Time.Milli, 100, { channels: 2, value: 0.0 });
		write(buffer, 10 as Time.Milli, 10, { channels: 2, value: 0.0 }); // This exits refill mode
		read(buffer, 110, 2);

		// Write 20 samples
		write(buffer, 11 as Time.Milli, 20, { channels: 2, value: 1.5 });

		// Read 10 samples
		const output = read(buffer, 10, 2);

		assert.strictEqual(output.length, 10);
		assert.strictEqual(buffer.length, 10);

		// Verify the data
		for (let channel = 0; channel < 2; channel++) {
			for (let i = 0; i < 10; i++) {
				assert.strictEqual(output[channel][i], 1.5);
			}
		}
	});

	await t.test("should handle partial reads", () => {
		const buffer = new AudioRingBuffer({ rate: 1000, channels: 2, latency: 100 as Time.Milli });

		// Exit refill mode first
		write(buffer, 0 as Time.Milli, 100, { channels: 2, value: 0.0 });
		write(buffer, 10 as Time.Milli, 10, { channels: 2, value: 0.0 }); // This exits refill mode
		read(buffer, 110, 2);

		// Write 20 samples
		write(buffer, 11 as Time.Milli, 20, { channels: 2, value: 1.0 });

		// Try to read 30 samples (only 20 available)
		const output = read(buffer, 30, 2);

		assert.strictEqual(output.length, 20);
		assert.strictEqual(buffer.length, 0);
	});

	await t.test("should return 0 when no data available", () => {
		const buffer = new AudioRingBuffer({ rate: 1000, channels: 2, latency: 100 as Time.Milli });

		const output = read(buffer, 10, 2);
		assert.strictEqual(output.length, 0);
	});

	await t.test("should return 0 when not initialized", () => {
		const buffer = new AudioRingBuffer({ rate: 1000, channels: 2, latency: 100 as Time.Milli });
		const output = read(buffer, 10, 2);
		assert.strictEqual(output.length, 0);
	});
});

test("refill behavior", async (t) => {
	await t.test("should start in refill mode", () => {
		const buffer = new AudioRingBuffer({ rate: 1000, channels: 2, latency: 100 as Time.Milli });
		assert.strictEqual(buffer.refilling, true);

		// Should not output anything in refill mode
		write(buffer, 0 as Time.Milli, 50, { channels: 2, value: 1.0 });
		const output = read(buffer, 10, 2);
		assert.strictEqual(output.length, 0);
	});

	await t.test("should exit refill mode when buffer is full", () => {
		const buffer = new AudioRingBuffer({ rate: 1000, channels: 2, latency: 100 as Time.Milli });

		// Fill the buffer completely
		write(buffer, 0 as Time.Milli, 100, { channels: 2, value: 1.0 });

		// Write more data to trigger overflow handling
		write(buffer, 10 as Time.Milli, 50, { channels: 2, value: 2.0 }); // This should exit refill mode

		assert.strictEqual(buffer.refilling, false);

		// Now we should be able to read
		const output = read(buffer, 10, 2);
		assert.strictEqual(output.length, 10);
	});
});

test("ring buffer wrapping", async (t) => {
	await t.test("should wrap around when buffer is full", () => {
		const buffer = new AudioRingBuffer({ rate: 1000, channels: 1, latency: 100 as Time.Milli });

		// Fill the buffer
		write(buffer, 0 as Time.Milli, 100, { channels: 1, value: 1.0 });

		// Write more data, causing wrap
		write(buffer, 10 as Time.Milli, 50, { channels: 1, value: 2.0 });
		assert.strictEqual(buffer.refilling, false);

		// Read some data to advance read pointer
		read(buffer, 50, 1);

		// Write more data that wraps
		write(buffer, 15 as Time.Milli, 50, { channels: 1, value: 3.0 });

		// Read and verify wrap-around works
		const output2 = read(buffer, 100, 1);
		assert.strictEqual(output2.length, 100);

		// First 50 should be 2.0, next 50 should be 3.0
		for (let i = 0; i < 50; i++) {
			assert.strictEqual(output2[0][i], 2.0);
		}
		for (let i = 50; i < 100; i++) {
			assert.strictEqual(output2[0][i], 3.0);
		}
	});
});

test("multi-channel handling", async (t) => {
	await t.test("should handle different channel counts correctly", () => {
		const buffer = new AudioRingBuffer({ rate: 1000, channels: 2, latency: 100 as Time.Milli });

		// Exit refill mode first
		write(buffer, 0 as Time.Milli, 100, { channels: 2, value: 0.0 });
		write(buffer, 10 as Time.Milli, 10, { channels: 2, value: 0.0 }); // This exits refill mode
		read(buffer, 110, 2);

		// Write mono data (1 channel) - should only fill first channel, second channel gets zeros
		write(buffer, 11 as Time.Milli, 10, { channels: 1, value: 1.0 });

		// Write stereo data
		write(buffer, 12 as Time.Milli, 10, { channels: 2, value: 2.0 });

		// Read and verify
		const output = read(buffer, 20, 2);
		assert.strictEqual(output.length, 20);

		// First channel should have both mono and stereo data
		for (let i = 0; i < 10; i++) {
			assert.strictEqual(output[0][i], 1.0);
		}
		for (let i = 10; i < 20; i++) {
			assert.strictEqual(output[0][i], 2.0);
		}

		// Second channel should have zeros for mono part, then stereo data
		for (let i = 0; i < 10; i++) {
			assert.strictEqual(output[1][i], 0);
		}
		for (let i = 10; i < 20; i++) {
			assert.strictEqual(output[1][i], 2.0);
		}
	});
});

test("edge cases", async (t) => {
	await t.test("should handle empty output array", () => {
		const buffer = new AudioRingBuffer({ rate: 1000, channels: 2, latency: 100 as Time.Milli });
		write(buffer, 0 as Time.Milli, 50, { channels: 2, value: 1.0 });

		const output: Float32Array[] = [];
		const samplesRead = buffer.read(output);
		assert.strictEqual(samplesRead, 0);
	});

	await t.test("should handle zero-length output buffers", () => {
		const buffer = new AudioRingBuffer({ rate: 1000, channels: 2, latency: 100 as Time.Milli });
		write(buffer, 0 as Time.Milli, 50, { channels: 2, value: 1.0 });

		const output = [new Float32Array(0), new Float32Array(0)];
		const samplesRead = buffer.read(output);
		assert.strictEqual(samplesRead, 0);
	});

	await t.test("should handle fractional timestamps", () => {
		const buffer = new AudioRingBuffer({ rate: 1000, channels: 2, latency: 100 as Time.Milli });

		// Exit refill mode first
		write(buffer, 0 as Time.Milli, 100, { channels: 2, value: 0.0 });
		write(buffer, 10 as Time.Milli, 10, { channels: 2, value: 0.0 }); // This exits refill mode
		read(buffer, 110, 2);

		// Write with fractional timestamp that rounds
		write(buffer, 1105 as Time.Milli, 10, { channels: 2, value: 1.0 }); // 110.5 samples, rounds to 111
		write(buffer, 1204 as Time.Milli, 10, { channels: 2, value: 2.0 }); // 120.4 samples, rounds to 120

		const output = read(buffer, 20, 2);
		assert.ok(output.length > 0);
	});
});
