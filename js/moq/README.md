<p align="center">
	<img height="128px" src="https://github.com/moq-dev/moq/blob/main/.github/logo.svg" alt="Media over QUIC">
</p>

# @moq/lite

[![npm version](https://img.shields.io/npm/v/@moq/lite)](https://www.npmjs.com/package/@moq/lite)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-blue.svg)](https://www.typescriptlang.org/)

A TypeScript implementation of [Media over QUIC](https://moq.dev/) (MoQ) providing real-time data delivery in web browsers.
Specificially, this package implements the networking layer called [moq-lite](https://moq.dev/blog/moq-lite).
Check out [../hang] for a higher-level media library that uses this package.

> **Note:** This project is a [fork](https://moq.dev/blog/transfork) of the [IETF MoQ specification](https://datatracker.ietf.org/group/moq/documents/), optimized for practical deployment with a narrower focus and exponentially simpler implementation.

## Quick Start

```bash
npm add @moq/lite
# or
pnpm add @moq/lite
bun add @moq/lite
yarn add @moq/lite
# etc
```

### Basic Connection

```typescript
import * as Moq from "@moq/lite";

// Connect to a MoQ relay server
const connection = await Moq.connect("https://cdn.moq.dev/anon");
console.log("Connected to MoQ relay!");
```

### Publishing Data

```typescript
import * as Moq from "@moq/lite";

const connection = await Moq.connect("https://cdn.moq.dev/anon");

// Create a broadcast, not associated with any connection/name yet.
const broadcast = new Moq.BroadcastProducer();

// Create a track within the broadcast
const track = broadcast.createTrack("chat");

// Send data in groups (e.g., keyframe boundaries)
const group = track.appendGroup();
group.writeString("Hello, MoQ!");
group.close();

// Publish the broadcast to the connection
connection.publish("my-broadcast", broadcast.consume());
console.log("Published data to my-broadcast");
```

### Subscribing to Data

```typescript
import * as Moq from "@moq/lite";

const connection = await Moq.connect("https://cdn.moq.dev/anon");

// Subscribe to a broadcast
const broadcast = connection.consume("my-broadcast");

// Subscribe to a specific track
const track = await broadcast.subscribe("chat");

// Read data as it arrives
for (;;) {
	const group = await track.nextGroup();
	if (!group) break;

	for (;;) {
		const frame = await group.readString();
		if (!frame) break;

        console.log("Received:", frame);
    }
}
```

### Stream Discovery

```typescript
import * as Moq from "@moq/lite";

const connection = await Moq.connect("https://cdn.moq.dev/anon");

// Discover broadcasts announced by the server
let announcement = await connection.announced();
while (announcement) {
    console.log("New stream available:", announcement.name);

    // Subscribe to new streams
    const broadcast = connection.consume(announcement.name);
    // ... handle the broadcast

    announcement = await announced.next();
}
```

## License

Licensed under either:

-   Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
-   MIT license ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)
