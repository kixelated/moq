import * as Moq from "@kixelated/moq";
import { describe, expect, it } from "vitest";
import { Consumer, Producer } from "./frame";
import * as Time from "./time";

describe("Consumer", () => {
	it("should close cleanly", async () => {
		// Create a broadcast and track
		const broadcast = new Moq.BroadcastProducer();
		const track = broadcast.createTrack("test");
		const producer = new Producer(track);

		// Create consumer from the track
		const consumer = new Consumer(track.consume());

		producer.encode(new Uint8Array([1]), Time.Micro.fromMilli(1 as Time.Milli), true);
		producer.close();

		// Close consumer before trying to decode
		consumer.close();

		const frame = await consumer.decode();
		expect(frame).toBeUndefined();

		// Clean up
		broadcast.close();
	});
});
