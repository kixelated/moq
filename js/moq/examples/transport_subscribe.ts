#!/usr/bin/env -S deno run --allow-net --allow-env --unstable-net

/**
 * Usage:
 *   ./transport_subscribe.ts [hostname]
 *   MOQ_HOST=relay.example.com ./transport_subscribe.ts
 *   deno run --allow-net --allow-env --unstable-net examples/transport_subscribe.ts relay.example.com
 */

import { Path } from "../src";
import { connect } from "../src/transport";

async function main() {
	// Get hostname from command line argument or environment variable
	const hostname = Deno.args[0] || Deno.env.get("MOQ_HOST");
	if (!hostname) {
		console.error("Error: No hostname provided");
		console.error("Usage: ./transport_subscribe.ts [hostname]");
		console.error("   or: MOQ_HOST=relay.example.com ./transport_subscribe.ts");
		Deno.exit(1);
	}
	const SERVER_URL = new URL(`https://${hostname}`);
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
