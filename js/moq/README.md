<p align="center">
	<img height="128px" src="https://github.com/kixelated/moq/blob/main/.github/logo.svg" alt="Media over QUIC">
</p>

# @kixelated/moq

[![npm version](https://img.shields.io/npm/v/@kixelated/moq)](https://www.npmjs.com/package/@kixelated/moq)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-blue.svg)](https://www.typescriptlang.org/)

A TypeScript implementation of [Media over QUIC](https://quic.video/) (MoQ) providing real-time data delivery in web browsers.
Specificially, this package implements the networking layer called [moq-lite](https://quic.video/blog/moq-lite).
Check out [../hang] for a higher-level media library that uses this package.

> **Note:** This project is a [fork](https://quic.video/blog/transfork) of the [IETF MoQ specification](https://datatracker.ietf.org/group/moq/documents/), optimized for practical deployment with a narrower focus and exponentially simpler implementation.

## Quick Start

```bash
npm install @kixelated/moq
# or
pnpm add @kixelated/moq
# or
yarn add @kixelated/moq
```

### Basic Connection

```typescript
import * as Moq from "@kixelated/moq";

// Connect to a MoQ relay server
const connection = await Moq.connect("https://relay.quic.video/anon");
console.log("Connected to MoQ relay!");
```

### Publishing Data

```typescript
import * as Moq from "@kixelated/moq";

const connection = await Moq.connect("https://relay.quic.video/anon");

// Create a broadcast, not associated with any connection/name yet.
const broadcast = new Moq.BroadcastProducer();

// Create a track within the broadcast
const track = broadcast.createTrack("chat");

// Send data in groups (e.g., keyframe boundaries)
const group = track.createGroup();
await group.writeFrame(new TextEncoder().encode("Hello, MoQ!"));
await group.close();

// Publish the broadcast to the connection
connection.publish("my-broadcast", broadcast);
console.log("Published data to my-broadcast");
```

### Subscribing to Data

```typescript
import * as Moq from "@kixelated/moq";

const connection = await Moq.connect("https://relay.quic.video/anon");

// Subscribe to a broadcast
const broadcast = connection.consume("my-broadcast");

// Subscribe to a specific track
const track = await broadcast.subscribe("chat");

// Read data as it arrives
for (;;) {
	const group = await track.next();
	if (!group) break;

	for (;;) {
		const frame = await group.next();
		if (!frame) break;

        const text = new TextDecoder().decode(frame.data);
        console.log("Received:", text);
    }
}
```

### Stream Discovery

```typescript
import * as Moq from "@kixelated/moq";

const connection = await Moq.connect("https://relay.quic.video/anon");

// Discover streams with an optional prefix
const announced = connection.announced("");

for await (const announcement of announced) {
    console.log("New stream available:", announcement.name);

    // Subscribe to new streams
    const broadcast = connection.consume(announcement.name);
    // ... handle the broadcast
}
```

## License

Licensed under either:

-   Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
-   MIT license ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)
