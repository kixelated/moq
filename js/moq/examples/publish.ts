#!/usr/bin/env -S deno run --allow-net --allow-env --unstable-net --unstable-sloppy-imports

// Replace with "@kixelated/moq"
import { BroadcastProducer, connect, Path } from "../src"

// Get hostname from command line argument or environment variable
const url = Deno.args[0] || Deno.env.get("MOQ_URL");
const name = Deno.args[1] || Deno.env.get("MOQ_NAME");
if (!url || !name) {
	console.error("Error: invalid arguments");
	console.error("Usage: ./publish.ts [url] [name]");
	console.error("   or: MOQ_URL=https://relay.example.com MOQ_NAME=test ./publish.ts");
	Deno.exit(1);
}

const connection = await connect(new URL(url));
console.log("✅ Connected to relay:", url);

// Create a new "broadcast", which is a collection of tracks.
const broadcastProducer = new BroadcastProducer();
connection.publish(Path.from(name), broadcastProducer.consume());

console.log("✅ Published broadcast:", name);

// Within our broadcast, create a single "clock" track.
const trackProducer = broadcastProducer.createTrack("clock");

// Send the current timestamp over the wire as a test.
let now = Date.now()
console.log("✅ Publishing the current time");

// NOTE: No data flows over the network until there's an active subscription
// You can think of trackProducer as a cache, storing data until needed.

for (;;) {
	// Create a JSON message just because it's easy.
	// Any binary encoding will work.
	const json = JSON.stringify({now});

	// NOTE: `appendFrame` automatically create a new group for you.
	// This means the previous message is not a dependency, and will be dropped from cache.
	// If you don't want that behavior, use `appendGroup` instead to control group boundaries.
	trackProducer.appendFrame(new TextEncoder().encode(json));

	// Sleep for a second
	// I'm too lazy to sleep for the correct amount of time, so just += 1
	await new Promise((resolve) => setTimeout(resolve, 1000));
	now += 1
}
