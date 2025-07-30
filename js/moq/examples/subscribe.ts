#!/usr/bin/env -S deno run --allow-net --allow-env --unstable-net --unstable-sloppy-imports

// Replace with "@kixelated/moq"
import { connect, Path } from "../src"

// Get hostname from command line argument or environment variable
const url = Deno.args[0] || Deno.env.get("MOQ_HOST");
const name = Deno.args[1] || Deno.env.get("MOQ_NAME");
if (!url || !name) {
	console.error("Error: invalid arguments");
	console.error("Usage: ./publish.ts [url] [name]");
	console.error("   or: MOQ_URL=https://relay.example.com MOQ_NAME=test ./publish.ts");
	Deno.exit(1);
}
const connection = await connect(new URL(url));
console.log("✅ Connected to relay");

// Optionally wait for the broadcast to be announced.
// You can use a shorter prefix if you care about multiple broadcasts.
const prefix = Path.from(name);
const announced = connection.announced(prefix);

console.log("🔍 Waiting for announce:", prefix);

// Start a 1 second timeout because announcements are technically not required.
// But you're pretty screwed if you don't get one.
const timeout = new Promise((resolve) => setTimeout(resolve, 1000));

const announce = await Promise.race([announced.next(), timeout]);
if (!announce) {
	console.warn("⚠️ No announce found after 1 second, subscribing anyway...");
} else {
	console.log("🎉 Announced:", announce);
}

const broadcast = connection.consume(Path.from(name));
const track = broadcast.subscribe("clock", 0);

for (;;) {
	const msg = await track.nextFrame();
	if (msg) {
		console.log("🎉 Got message:", new TextDecoder().decode(msg.data));
	} else {
		console.log("❌ No message found");
		break;
	}
}
