import assert from "node:assert";
import test from "node:test";
import type * as Time from "../../time";
import { AudioRingBuffer } from "./ring-buffer";

function createData(samples: number, channelCount = 2, value = 1.0): Float32Array[] {
	const data: Float32Array[] = [];
	for (let i = 0; i < channelCount; i++) {
		const channel = new Float32Array(samples);
		channel.fill(value);
		data.push(channel);
	}
	return data;
}

function createOutput(samples: number, channelCount = 2): Float32Array[] {
	const output: Float32Array[] = [];
	for (let i = 0; i < channelCount; i++) {
		output.push(new Float32Array(samples));
	}
	return output;
}

test("initialization", async (t) => {
	await t.test("should initialize with valid parameters", () => {
		const buffer = new AudioRingBuffer();

		buffer.initialize({ sampleRate: 48000, channelCount: 2, latency: 100 as Time.Milli });

		assert.strictEqual(buffer.capacity, 4800); // 48000 * 0.1
		assert.strictEqual(buffer.length, 0);
		assert.strictEqual(buffer.utilization, 0);
	});

	await t.test("should throw on invalid channel count", () => {
		const buffer = new AudioRingBuffer();

		assert.throws(
			() => buffer.initialize({ sampleRate: 48000, channelCount: 0, latency: 100 as Time.Milli }),
			/invalid channels/,
		);
	});

	await t.test("should throw on invalid sample rate", () => {
		const buffer = new AudioRingBuffer();

		assert.throws(
			() => buffer.initialize({ sampleRate: 0, channelCount: 2, latency: 100 as Time.Milli }),
			/invalid sample rate/,
		);
	});

	await t.test("should throw on invalid latency", () => {
		const buffer = new AudioRingBuffer();

		assert.throws(
			() => buffer.initialize({ sampleRate: 48000, channelCount: 2, latency: 0 as Time.Milli }),
			/invalid latency/,
		);
	});

	await t.test("should throw on double initialization", () => {
		const buffer = new AudioRingBuffer();

		buffer.initialize({ sampleRate: 48000, channelCount: 2, latency: 100 as Time.Milli });
		assert.throws(
			() => buffer.initialize({ sampleRate: 48000, channelCount: 2, latency: 100 as Time.Milli }),
			/already initialized/,
		);
	});
});

test("writing data", async (t) => {
	await t.test("should write continuous data", () => {
		const buffer = new AudioRingBuffer();
		buffer.initialize({ sampleRate: 1000, channelCount: 2, latency: 100 as Time.Milli }); // 100 samples buffer

		// Write 10 samples at timestamp 0
		buffer.write(0 as Time.Milli, createData(10, 2, 1.0));
		assert.strictEqual(buffer.length, 10);

		// Write 10 more samples at timestamp 10ms
		buffer.write(10 as Time.Milli, createData(10, 2, 2.0));
		assert.strictEqual(buffer.length, 20);
	});

	await t.test("should handle gaps by filling with zeros", () => {
		const buffer = new AudioRingBuffer();
		buffer.initialize({ sampleRate: 1000, channelCount: 2, latency: 100 as Time.Milli }); // 100 samples buffer

		// Write at timestamp 0
		buffer.write(0 as Time.Milli, createData(10, 2, 1.0));

		// Write at timestamp 0.02 (20ms), creating a 10 sample gap
		buffer.write(20 as Time.Milli, createData(10, 2, 2.0));

		// Should have filled the gap with zeros
		assert.strictEqual(buffer.length, 30); // 10 + 10 (gap) + 10
	});

	await t.test("should handle late-arriving samples", () => {
		const buffer = new AudioRingBuffer();
		buffer.initialize({ sampleRate: 1000, channelCount: 1, latency: 100 as Time.Milli }); // 100 samples buffer, 1 channel for simplicity

		// Fill buffer to exit refill mode
		buffer.write(0 as Time.Milli, createData(100, 1, 0.0));
		buffer.write(10 as Time.Milli, createData(10, 1, 0.0)); // This exits refill mode

		// Clear the buffer
		const clearOutput = createOutput(110, 1);
		buffer.read(clearOutput);

		// Write at timestamp 0.12 (120ms) - creates a gap
		buffer.write(12 as Time.Milli, createData(10, 1, 1.0));

		// Now write data that fills the gap at timestamp 0.11 (110ms)
		buffer.write(11 as Time.Milli, createData(10, 1, 2.0));

		// Read and verify both writes are present
		const output = createOutput(20, 1);
		const samplesRead = buffer.read(output);
		assert.strictEqual(samplesRead, 20);

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
		const buffer = new AudioRingBuffer();
		buffer.initialize({ sampleRate: 1000, channelCount: 2, latency: 100 as Time.Milli }); // 100 samples buffer

		// Exit refill mode first
		buffer.write(0 as Time.Milli, createData(100, 2, 0.0));
		buffer.write(10 as Time.Milli, createData(10, 2, 0.0)); // This exits refill mode
		const clearOutput = createOutput(110, 2);
		buffer.read(clearOutput);

		// Write 50 samples
		buffer.write(11 as Time.Milli, createData(50, 2, 1.0));
		const output = createOutput(10, 2);
		buffer.read(output); // Read 10 samples, readIndex now at 120

		// Try to write data that's before the read index (at sample 110, which is before 120)
		buffer.write(11 as Time.Milli, createData(5, 2, 2.0)); // These should be ignored

		// Available should be 40 (50 - 10 read)
		assert.strictEqual(buffer.length, 40);
	});

	await t.test("should throw when writing to uninitialized buffer", () => {
		const buffer = new AudioRingBuffer();
		assert.throws(() => buffer.write(0 as Time.Milli, createData(10)), /not initialized/);
	});
});

test("reading data", async (t) => {
	await t.test("should read available data", () => {
		const buffer = new AudioRingBuffer();
		buffer.initialize({ sampleRate: 1000, channelCount: 2, latency: 100 as Time.Milli });

		// Exit refill mode first
		buffer.write(0 as Time.Milli, createData(100, 2, 0.0));
		buffer.write(10 as Time.Milli, createData(10, 2, 0.0)); // This exits refill mode
		const clearOutput = createOutput(110, 2);
		buffer.read(clearOutput);

		// Write 20 samples
		buffer.write(11 as Time.Milli, createData(20, 2, 1.5));

		// Read 10 samples
		const output = createOutput(10, 2);
		const samplesRead = buffer.read(output);

		assert.strictEqual(samplesRead, 10);
		assert.strictEqual(buffer.length, 10);

		// Verify the data
		for (let channel = 0; channel < 2; channel++) {
			for (let i = 0; i < 10; i++) {
				assert.strictEqual(output[channel][i], 1.5);
			}
		}
	});

	await t.test("should handle partial reads", () => {
		const buffer = new AudioRingBuffer();
		buffer.initialize({ sampleRate: 1000, channelCount: 2, latency: 100 as Time.Milli });

		// Exit refill mode first
		buffer.write(0 as Time.Milli, createData(100, 2, 0.0));
		buffer.write(10 as Time.Milli, createData(10, 2, 0.0)); // This exits refill mode
		const clearOutput = createOutput(110, 2);
		buffer.read(clearOutput);

		// Write 20 samples
		buffer.write(11 as Time.Milli, createData(20, 2, 1.0));

		// Try to read 30 samples (only 20 available)
		const output = createOutput(30, 2);
		const samplesRead = buffer.read(output);

		assert.strictEqual(samplesRead, 20);
		assert.strictEqual(buffer.length, 0);
	});

	await t.test("should return 0 when no data available", () => {
		const buffer = new AudioRingBuffer();
		buffer.initialize({ sampleRate: 1000, channelCount: 2, latency: 100 as Time.Milli });

		const output = createOutput(10, 2);
		const samplesRead = buffer.read(output);

		assert.strictEqual(samplesRead, 0);
	});

	await t.test("should return 0 when not initialized", () => {
		const buffer = new AudioRingBuffer();
		const output = createOutput(10, 2);
		const samplesRead = buffer.read(output);

		assert.strictEqual(samplesRead, 0);
	});
});

test("refill behavior", async (t) => {
	await t.test("should start in refill mode", () => {
		const buffer = new AudioRingBuffer();
		buffer.initialize({ sampleRate: 1000, channelCount: 2, latency: 100 as Time.Milli });

		assert.strictEqual(buffer.refilling, true);

		// Should not output anything in refill mode
		buffer.write(0 as Time.Milli, createData(50, 2, 1.0));
		const output = createOutput(10, 2);
		const samplesRead = buffer.read(output);

		assert.strictEqual(samplesRead, 0);
	});

	await t.test("should exit refill mode when buffer is full", () => {
		const buffer = new AudioRingBuffer();
		buffer.initialize({ sampleRate: 1000, channelCount: 2, latency: 100 as Time.Milli }); // 100 samples buffer

		// Fill the buffer completely
		buffer.write(0 as Time.Milli, createData(100, 2, 1.0));

		// Write more data to trigger overflow handling
		buffer.write(10 as Time.Milli, createData(50, 2, 2.0)); // This should exit refill mode

		assert.strictEqual(buffer.refilling, false);

		// Now we should be able to read
		const output = createOutput(10, 2);
		const samplesRead = buffer.read(output);
		assert.strictEqual(samplesRead, 10);
	});
});

test("ring buffer wrapping", async (t) => {
	await t.test("should wrap around when buffer is full", () => {
		const buffer = new AudioRingBuffer();
		buffer.initialize({ sampleRate: 1000, channelCount: 1, latency: 100 as Time.Milli }); // 100 samples buffer, 1 channel

		// Fill the buffer
		buffer.write(0 as Time.Milli, createData(100, 1, 1.0));

		// Write more data, causing wrap
		buffer.write(10 as Time.Milli, createData(50, 1, 2.0));
		assert.strictEqual(buffer.refilling, false);

		// Read some data to advance read pointer
		const output1 = createOutput(50, 1);
		buffer.read(output1);

		// Write more data that wraps
		buffer.write(15 as Time.Milli, createData(50, 1, 3.0));

		// Read and verify wrap-around works
		const output2 = createOutput(100, 1);
		const samplesRead = buffer.read(output2);
		assert.strictEqual(samplesRead, 100);

		// First 50 should be 2.0, next 50 should be 3.0
		for (let i = 0; i < 50; i++) {
			assert.strictEqual(output2[0][i], 2.0);
		}
		for (let i = 50; i < 100; i++) {
			assert.strictEqual(output2[0][i], 3.0);
		}
	});
});

test("status reporting", async (t) => {
	await t.test("should report correct status", () => {
		const buffer = new AudioRingBuffer();
		buffer.initialize({ sampleRate: 1000, channelCount: 2, latency: 100 as Time.Milli }); // 100 samples buffer

		// Initially empty
		let status = buffer.status();
		assert.strictEqual(status.type, "status");
		assert.strictEqual(status.available, 0);
		assert.strictEqual(status.utilization, 0);

		// Add 50 samples
		buffer.write(0 as Time.Milli, createData(50, 2, 1.0));
		status = buffer.status();
		assert.strictEqual(status.available, 50);
		assert.strictEqual(status.utilization, 0.5);

		// Fill buffer
		buffer.write(5 as Time.Milli, createData(50, 2, 1.0));
		status = buffer.status();
		assert.strictEqual(status.available, 100);
		assert.strictEqual(status.utilization, 1.0);
	});
});

test("multi-channel handling", async (t) => {
	await t.test("should handle different channel counts correctly", () => {
		const buffer = new AudioRingBuffer();
		buffer.initialize({ sampleRate: 1000, channelCount: 2, latency: 100 as Time.Milli }); // 2 channel buffer

		// Exit refill mode first
		buffer.write(0 as Time.Milli, createData(100, 2, 0.0));
		buffer.write(10 as Time.Milli, createData(10, 2, 0.0)); // This exits refill mode
		const clearOutput = createOutput(110, 2);
		buffer.read(clearOutput);

		// Write mono data (1 channel) - should only fill first channel, second channel gets zeros
		const monoData = createData(10, 1, 1.0);
		buffer.write(11 as Time.Milli, monoData);

		// Write stereo data
		const stereoData = createData(10, 2, 2.0);
		buffer.write(12 as Time.Milli, stereoData);

		// Read and verify
		const output = createOutput(20, 2);
		const samplesRead = buffer.read(output);
		assert.strictEqual(samplesRead, 20);

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
		const buffer = new AudioRingBuffer();
		buffer.initialize({ sampleRate: 1000, channelCount: 2, latency: 100 as Time.Milli });
		buffer.write(0 as Time.Milli, createData(50, 2, 1.0));

		const output: Float32Array[] = [];
		const samplesRead = buffer.read(output);
		assert.strictEqual(samplesRead, 0);
	});

	await t.test("should handle zero-length output buffers", () => {
		const buffer = new AudioRingBuffer();
		buffer.initialize({ sampleRate: 1000, channelCount: 2, latency: 100 as Time.Milli });
		buffer.write(0 as Time.Milli, createData(50, 2, 1.0));

		const output = [new Float32Array(0), new Float32Array(0)];
		const samplesRead = buffer.read(output);
		assert.strictEqual(samplesRead, 0);
	});

	await t.test("should handle fractional timestamps", () => {
		const buffer = new AudioRingBuffer();
		buffer.initialize({ sampleRate: 1000, channelCount: 2, latency: 100 as Time.Milli });

		// Exit refill mode first
		buffer.write(0 as Time.Milli, createData(100, 2, 0.0));
		buffer.write(10 as Time.Milli, createData(10, 2, 0.0)); // This exits refill mode
		const clearOutput = createOutput(110, 2);
		buffer.read(clearOutput);

		// Write with fractional timestamp that rounds
		buffer.write(1105 as Time.Milli, createData(10, 2, 1.0)); // 110.5 samples, rounds to 111
		buffer.write(1204 as Time.Milli, createData(10, 2, 2.0)); // 120.4 samples, rounds to 120

		const output = createOutput(20, 2);
		const samplesRead = buffer.read(output);
		assert.ok(samplesRead > 0);
	});
});
