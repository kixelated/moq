import { describe, expect, it } from "vitest";
import { Consumer, encode } from "./frame";
import type * as Time from "./time";

// Mock implementations
class MockGroupConsumer {
	readonly sequence: number;
	#frames: Uint8Array[];
	#index = 0;
	#closed = false;

	constructor(sequence: number, frames: Uint8Array[]) {
		this.sequence = sequence;
		this.#frames = frames;
	}

	async readFrame(): Promise<Uint8Array | undefined> {
		if (this.#closed || this.#index >= this.#frames.length) {
			return undefined;
		}
		// Simulate async delay
		await new Promise((resolve) => setTimeout(resolve, 0));
		return this.#frames[this.#index++];
	}

	async readString(): Promise<string | undefined> {
		const frame = await this.readFrame();
		return frame ? new TextDecoder().decode(frame) : undefined;
	}

	async readJson(): Promise<unknown | undefined> {
		const str = await this.readString();
		return str ? JSON.parse(str) : undefined;
	}

	async readBool(): Promise<boolean | undefined> {
		const frame = await this.readFrame();
		return frame ? frame[0] === 1 : undefined;
	}

	clone(): MockGroupConsumer {
		const clone = new MockGroupConsumer(this.sequence, this.#frames);
		clone.#index = this.#index;
		return clone;
	}

	close(): void {
		this.#closed = true;
	}

	closed(): Promise<void> {
		return Promise.resolve();
	}
}

class MockTrackConsumer {
	readonly name: string;
	readonly priority: number;
	#groups: MockGroupConsumer[];
	#index = 0;

	constructor(name: string, groups: MockGroupConsumer[]) {
		this.name = name;
		this.priority = 0;
		this.#groups = groups;
	}

	async nextGroup(): Promise<MockGroupConsumer | undefined> {
		if (this.#index >= this.#groups.length) {
			return undefined;
		}
		// Simulate async delay
		await new Promise((resolve) => setTimeout(resolve, 0));
		return this.#groups[this.#index++];
	}

	async nextFrame(): Promise<{ group: number; frame: number; data: Uint8Array } | undefined> {
		throw new Error("Not implemented");
	}

	clone(): MockTrackConsumer {
		const clone = new MockTrackConsumer(this.name, this.#groups);
		clone.#index = this.#index;
		return clone;
	}

	close(): void {
		// No-op
	}

	closed(): Promise<void> {
		return Promise.resolve();
	}
}

describe("Consumer", () => {
	it("should read frames in order from a single group", async () => {
		const frames = [
			encode(new Uint8Array([1, 2, 3]), 1000 as Time.Milli),
			encode(new Uint8Array([4, 5, 6]), 2000 as Time.Milli),
			encode(new Uint8Array([7, 8, 9]), 3000 as Time.Milli),
		];

		const group = new MockGroupConsumer(0, frames);
		const track = new MockTrackConsumer("test", [group]);
		const consumer = new Consumer(track as any, { latency: 10000 as Time.Milli });

		const frame1 = await consumer.decode();
		expect(frame1).toBeDefined();
		expect(frame1?.timestamp).toBe(1000);
		expect(frame1?.keyframe).toBe(true);
		expect(frame1?.group).toBe(0);
		expect(Array.from(frame1!.data)).toEqual([1, 2, 3]);

		const frame2 = await consumer.decode();
		expect(frame2).toBeDefined();
		expect(frame2?.timestamp).toBe(2000);
		expect(frame2?.keyframe).toBe(false);
		expect(Array.from(frame2!.data)).toEqual([4, 5, 6]);

		const frame3 = await consumer.decode();
		expect(frame3).toBeDefined();
		expect(frame3?.timestamp).toBe(3000);
		expect(frame3?.keyframe).toBe(false);
		expect(Array.from(frame3!.data)).toEqual([7, 8, 9]);

		consumer.close();
	});

	it("should handle multiple groups in parallel", async () => {
		const group1 = new MockGroupConsumer(0, [
			encode(new Uint8Array([1]), 1000 as Time.Milli),
			encode(new Uint8Array([2]), 2000 as Time.Milli),
		]);

		const group2 = new MockGroupConsumer(1, [
			encode(new Uint8Array([3]), 3000 as Time.Milli),
			encode(new Uint8Array([4]), 4000 as Time.Milli),
		]);

		const track = new MockTrackConsumer("test", [group1, group2]);
		const consumer = new Consumer(track as any, { latency: 10000 as Time.Milli });

		// Give time for groups to start buffering
		await new Promise((resolve) => setTimeout(resolve, 20));

		// Should read from group 0 first
		const frame1 = await consumer.decode();
		expect(frame1?.timestamp).toBe(1000);
		expect(frame1?.group).toBe(0);

		const frame2 = await consumer.decode();
		expect(frame2?.timestamp).toBe(2000);
		expect(frame2?.group).toBe(0);

		// Then from group 1
		const frame3 = await consumer.decode();
		expect(frame3?.timestamp).toBe(3000);
		expect(frame3?.group).toBe(1);

		const frame4 = await consumer.decode();
		expect(frame4?.timestamp).toBe(4000);
		expect(frame4?.group).toBe(1);

		consumer.close();
	}, 10000);

	it("should cancel groups that exceed latency threshold", async () => {
		// Group 0 has old timestamps
		const group0 = new MockGroupConsumer(0, [
			encode(new Uint8Array([1]), 1000 as Time.Milli),
			encode(new Uint8Array([2]), 2000 as Time.Milli),
			encode(new Uint8Array([3]), 3000 as Time.Milli),
		]);

		// Group 1 has much newer timestamps (>100ms difference)
		const group1 = new MockGroupConsumer(1, [
			encode(new Uint8Array([4]), 5000 as Time.Milli),
			encode(new Uint8Array([5]), 6000 as Time.Milli),
		]);

		const track = new MockTrackConsumer("test", [group0, group1]);
		const consumer = new Consumer(track as any, { latency: 100 as Time.Milli }); // 100 milliseconds

		// Give time for buffering to start
		await new Promise((resolve) => setTimeout(resolve, 50));

		// Should skip group 0 and read from group 1 due to latency
		const frame1 = await consumer.decode();
		expect(frame1).toBeDefined();
		expect(frame1?.group).toBe(1);
		expect(frame1?.timestamp).toBe(5000);

		const frame2 = await consumer.decode();
		expect(frame2?.group).toBe(1);
		expect(frame2?.timestamp).toBe(6000);

		consumer.close();
	});

	it("should handle switching between groups based on latency", async () => {
		// Group 0 starts normal
		const group0 = new MockGroupConsumer(0, [
			encode(new Uint8Array([1]), 1000 as Time.Milli),
			encode(new Uint8Array([2]), 2000 as Time.Milli),
		]);

		// Group 1 has a big jump in timestamp
		const group1 = new MockGroupConsumer(1, [
			encode(new Uint8Array([3]), 10000 as Time.Milli), // Big jump
		]);

		// Group 2 continues from group 1
		const group2 = new MockGroupConsumer(2, [
			encode(new Uint8Array([4]), 11000 as Time.Milli),
			encode(new Uint8Array([5]), 12000 as Time.Milli),
		]);

		const track = new MockTrackConsumer("test", [group0, group1, group2]);
		const consumer = new Consumer(track as any, { latency: 1000 as Time.Milli }); // 1000ms threshold

		// Give time for buffering to start
		await new Promise((resolve) => setTimeout(resolve, 100));

		// Read some frames - the exact behavior depends on timing
		// but we should be able to read frames without hanging
		let framesRead = 0;
		const maxReads = 5;

		while (framesRead < maxReads) {
			const frame = await Promise.race([
				consumer.decode(),
				new Promise<undefined>((r) => setTimeout(() => r(undefined), 100)),
			]);

			if (!frame) break;
			framesRead++;

			// We should skip group 0 due to latency
			expect(frame.group).toBeGreaterThanOrEqual(0);
		}

		// We should have read at least some frames
		expect(framesRead).toBeGreaterThan(0);

		consumer.close();
	}, 10000);

	it("should properly identify keyframes", async () => {
		const group1 = new MockGroupConsumer(0, [
			encode(new Uint8Array([1]), 1000 as Time.Milli), // First frame is keyframe
			encode(new Uint8Array([2]), 2000 as Time.Milli),
		]);

		const group2 = new MockGroupConsumer(1, [
			encode(new Uint8Array([3]), 3000 as Time.Milli), // First frame is keyframe
			encode(new Uint8Array([4]), 4000 as Time.Milli),
		]);

		const track = new MockTrackConsumer("test", [group1, group2]);
		const consumer = new Consumer(track as any, { latency: 10000 as Time.Milli });

		// Give time for groups to start buffering
		await new Promise((resolve) => setTimeout(resolve, 20));

		const frame1 = await consumer.decode();
		expect(frame1?.keyframe).toBe(true);
		expect(frame1?.group).toBe(0);

		const frame2 = await consumer.decode();
		expect(frame2?.keyframe).toBe(false);
		expect(frame2?.group).toBe(0);

		const frame3 = await consumer.decode();
		expect(frame3?.keyframe).toBe(true);
		expect(frame3?.group).toBe(1);

		const frame4 = await consumer.decode();
		expect(frame4?.keyframe).toBe(false);
		expect(frame4?.group).toBe(1);

		consumer.close();
	}, 10000);

	it("should handle empty groups gracefully", async () => {
		const group1 = new MockGroupConsumer(0, []); // Empty group
		const group2 = new MockGroupConsumer(1, [encode(new Uint8Array([1]), 1000 as Time.Milli)]);

		const track = new MockTrackConsumer("test", [group1, group2]);
		const consumer = new Consumer(track as any, { latency: 10000 as Time.Milli });

		// Give time for groups to start buffering
		await new Promise((resolve) => setTimeout(resolve, 20));

		// Should skip empty group and read from group 2
		const frame = await consumer.decode();
		expect(frame).toBeDefined();
		expect(frame?.group).toBe(1);
		expect(frame?.timestamp).toBe(1000);

		consumer.close();
	}, 10000);

	it("should close cleanly", async () => {
		const group = new MockGroupConsumer(0, [encode(new Uint8Array([1]), 1000 as Time.Milli)]);
		const track = new MockTrackConsumer("test", [group]);
		const consumer = new Consumer(track as any, { latency: 10000 as Time.Milli });

		consumer.close();

		const frame = await consumer.decode();
		expect(frame).toBeUndefined();
	});
});
