#!/usr/bin/env -S deno run --allow-net --allow-env --unstable-net

/**
 * Usage:
 *   ./transport_publish.ts [hostname]
 *   MOQ_HOST=relay.example.com ./transport_publish.ts
 *   deno run --allow-net --allow-env --unstable-net examples/transport_publish.ts relay.example.com
 */

import { BroadcastProducer, Path } from "../src";
import { connect } from "../src/transport";

// Get hostname from command line argument or environment variable
const hostname = Deno.args[0] || Deno.env.get("MOQ_HOST");
if (!hostname) {
	console.error("Error: No hostname provided");
	console.error("Usage: ./transport_publish.ts [hostname]");
	console.error("   or: MOQ_HOST=relay.example.com ./transport_publish.ts");
	Deno.exit(1);
}
const SERVER_URL = new URL(`https://${hostname}`);
const connection = await connect(SERVER_URL);

console.log("✅ Connected to moq-transport-07 server");

const prefix = Path.from("hang");
const name = Path.from("test4");

const path = Path.join(prefix, name);

const broadcastProducer = new BroadcastProducer();
connection.publish(path, broadcastProducer.consume());

const catalogProducer = broadcastProducer.createTrack("catalog.json");

const json = JSON.stringify({
	items: [
		{ id: 1, name: "Item 1" },
		{ id: 2, name: "Item 2" },
	],
});

catalogProducer.appendFrame(new TextEncoder().encode(json));

await catalogProducer.unused();
