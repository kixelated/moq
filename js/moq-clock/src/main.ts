#!/usr/bin/env -S deno run --allow-net --allow-env --unstable-net --unstable-sloppy-imports

import { parseArgs } from "jsr:@std/cli/parse-args";

import { BroadcastProducer, connect, Path } from "@kixelated/moq";

interface Config {
	url: string;
	broadcast: string;
	track: string;
	role: "publish" | "subscribe";
}

function parseConfig(): Config {
	const args = parseArgs(Deno.args, {
		string: ["url", "broadcast", "track"],
		boolean: ["help"],
		default: {
			track: "seconds",
		},
		alias: {
			h: "help",
		},
	});

	if (args.help) {
		console.log(`
Usage: ./main.ts [OPTIONS] <publish|subscribe>

OPTIONS:
    --url <URL>         Connect to the given URL starting with https://
    --broadcast <NAME>  The name of the broadcast to publish or subscribe to
    --track <NAME>      The name of the clock track [default: seconds]
    -h, --help          Print help information

COMMANDS:
    publish     Publish a clock broadcast
    subscribe   Subscribe to a clock broadcast

ENVIRONMENT VARIABLES:
    MOQ_URL     Default URL to connect to
    MOQ_NAME    Default broadcast name
		`);
		Deno.exit(0);
	}

	const role = args._[0] as string;
	if (!role || (role !== "publish" && role !== "subscribe")) {
		console.error("Error: Must specify 'publish' or 'subscribe' command");
		Deno.exit(1);
	}

	const url = args.url || Deno.env.get("MOQ_URL");
	const broadcast = args.broadcast || Deno.env.get("MOQ_NAME");

	if (!url || !broadcast) {
		console.error("Error: --url and --broadcast are required");
		console.error("Provide them as arguments or set MOQ_URL and MOQ_NAME environment variables");
		Deno.exit(1);
	}

	return {
		url,
		broadcast,
		track: args.track,
		role: role as "publish" | "subscribe",
	};
}

async function publish(config: Config) {
	const connection = await connect(new URL(config.url));
	console.log("✅ Connected to relay:", config.url);

	// Create a new "broadcast", which is a collection of tracks.
	const broadcastProducer = new BroadcastProducer();
	connection.publish(Path.from(config.broadcast), broadcastProducer.consume());

	console.log("✅ Published broadcast:", config.broadcast);

	// Within our broadcast, create a single track.
	const trackProducer = broadcastProducer.createTrack(config.track);

	// Send timestamps over the wire, matching the Rust implementation format
	console.log("✅ Publishing clock data on track:", config.track);

	// NOTE: No data flows over the network until there's an active subscription
	// You can think of trackProducer as a cache, storing data until needed.

	for (;;) {
		const now = new Date();

		// Create a new group for each minute (matching Rust implementation)
		const group = trackProducer.appendGroup();

		// Send the base timestamp (everything but seconds) - matching Rust format
		const base = `${now.toISOString().slice(0, 16).replace("T", " ")}:`;
		group.writeString(base);

		// Send individual seconds for this minute
		const currentMinute = now.getMinutes();

		while (new Date().getMinutes() === currentMinute) {
			const secondsNow = new Date();
			const seconds = secondsNow.getSeconds().toString().padStart(2, "0");

			group.writeString(seconds);

			// Wait until next second
			const nextSecond = new Date(secondsNow);
			nextSecond.setSeconds(nextSecond.getSeconds() + 1, 0);
			const delay = nextSecond.getTime() - secondsNow.getTime();

			if (delay > 0) {
				await new Promise((resolve) => setTimeout(resolve, delay));
			}

			// Check if we've moved to next minute
			if (new Date().getMinutes() !== currentMinute) {
				break;
			}
		}

		group.close();
	}
}

async function subscribe(config: Config) {
	const connection = await connect(new URL(config.url));
	console.log("✅ Connected to relay:", config.url);

	// Optionally wait for the broadcast to be announced.
	// You can use a shorter prefix if you care about multiple broadcasts.
	const prefix = Path.from(config.broadcast);
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

	const broadcast = connection.consume(Path.from(config.broadcast));
	const track = broadcast.subscribe(config.track, 0);

	console.log("✅ Subscribed to track:", config.track);

	// Handle groups and frames like the Rust implementation
	for (;;) {
		const group = await track.nextGroup();
		if (!group) {
			console.log("❌ Connection ended");
			break;
		}

		// Get the base timestamp (first frame in group)
		const baseFrame = await group.readFrame();
		if (!baseFrame) {
			console.warn("❌ No base frame found");
			continue;
		}

		const base = new TextDecoder().decode(baseFrame);

		// Read individual second frames
		for (;;) {
			const frame = await group.readString();
			if (!frame) {
				break; // End of group
			}

			const seconds = parseInt(frame, 10);

			// Clock emoji positions
			const clockEmojis = ["🕛", "🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚"];

			// Map 60 seconds to 12 clock positions (5 seconds per position)
			const clockIndex = Math.floor((seconds / 60) * clockEmojis.length) % clockEmojis.length;
			const clockEmoji = clockEmojis[clockIndex];

			console.log(clockEmoji, base + seconds);
		}
	}
}

try {
	const config = parseConfig();

	if (config.role === "publish") {
		await publish(config);
	} else {
		await subscribe(config);
	}
} catch (error) {
	console.error("❌ Error:", error);
	Deno.exit(1);
}
