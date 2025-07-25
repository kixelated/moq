#!/usr/bin/env deno run --allow-net --unstable-net --unstable-sloppy-imports examples/transport_publish.ts

/**
 * Usage:
 *   deno run --allow-net --unstable-net examples/transport.ts
 */

import { BroadcastProducer, Path } from "../src";
import { connect } from "../src/transport";

const SERVER_URL = new URL("https://relay.cloudflare.mediaoverquic.com");
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
