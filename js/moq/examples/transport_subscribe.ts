#!/usr/bin/env deno run --allow-net --unstable-net --unstable-sloppy-imports examples/transport_subscribe.ts

/**
 * Usage:
 *   deno run --allow-net --unstable-net examples/transport.ts
 */

import { Path } from "../src";
import { connect } from "../src/transport";

async function main() {
const SERVER_URL = new URL("https://relay.cloudflare.mediaoverquic.com");
const connection = await connect(SERVER_URL);

console.log("✅ Connected to moq-transport-07 server");

const prefix = Path.from("hang");
const name = Path.from("test4");

const path = Path.join(prefix, name);
const announced = connection.announced(prefix);

console.log("🔍 Waiting for announce:", path);
const timeout = new Promise((resolve) => setTimeout(resolve, 1000));
const announce = await Promise.race([announced.next(), timeout]);
if (!announce) {
	console.warn("⚠️ No announce found after 1 second, trying anyway...");
} else {
	console.log("🎉 Announced:", announce);
}

const broadcastConsumer = connection.consume(path);
const catalogConsumer = broadcastConsumer.subscribe("catalog.json", 0);

const data = await catalogConsumer.nextFrame();
if (data) {
	console.log("🎉 Got catalog:", new TextDecoder().decode(data.data));
} else {
	console.log("❌ No catalog found");
	return;
}









}
main();
