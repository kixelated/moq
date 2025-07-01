![License](https://img.shields.io/badge/license-MIT%2FApache--2.0-blue)
[![Discord](https://img.shields.io/discord/1124083992740761730)](https://discord.gg/FCYF3p99mr)
[![Crates.io](https://img.shields.io/crates/v/moq-lite)](https://crates.io/crates/moq-lite)
[![npm](https://img.shields.io/npm/v/@kixelated/moq)](https://www.npmjs.com/package/@kixelated/moq)

<p align="center">
	<img height="128px" src="https://github.com/kixelated/moq/blob/main/.github/logo.svg" alt="Media over QUIC">
</p>

# Media over QUIC

[Media over QUIC](https://quic.video) (MoQ) is a next-generation live media delivery protocol that provides **real-time latency** at **massive scale**.
Built on modern web technologies like [WebTransport](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API) and [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API), MoQ delivers WebRTC-like performance with CDN-like distribution.

**Key Features:**
- 🚀 **Real-time latency** via QUIC stream priotization and partial reliability.
- 📈 **Massive scale** via edge caching, fanout, and multi-region clustering.
- 🌐 **Browser support** via WebTransport and WebCodecs.
- 🔧 **Generic transport** for any live data, not just media
- 🎯 **Simple API** with both Rust and TypeScript implementations

> **Note:** This project is a [fork](https://quic.video/blog/transfork) of the [IETF MoQ specification](https://datatracker.ietf.org/group/moq/documents/). The focus is narrower, focusing on simplicity and practicality.


## Architecture

MoQ is designed as a layered protocol stack.

**Rule 1**: The CDN MUST NOT know anything about your application, media codecs, or even the available tracks.
Everything could be fully E2EE and the CDN wouldn't care; no business logic here.

Instead, [`moq-relay`](rs/moq-relay) operates on rules encoded in the [`moq-lite`](https://docs.rs/moq-lite) header.
These rules are based on video encoding but not really and can be used for really any live data.
The goal is to keep the server as dumb as possible and unlock economies of scale.

The media logic is split into another protocol called [`hang`](https://docs.rs/hang).
It's pretty simple and only intended to be used by clients or media servers.
If you want to do something more custom, then you can always extend it provided you control both clients.

Think of `hang` as like HLS/DASH, while `moq-lite` is like HTTP.


```
┌─────────────────┐
│   Application   │   🏢 Your business logic
│                 │    - authentication, non-media tracks, etc.
├─────────────────┤
│      hang       │   🎬 Media-specific encoding/streaming
│                 │     - codecs, containers, catalog
├─────────────────├
│    moq-lite     │  🚌 Generic pub/sub transport
│                 │     - broadcasts, tracks, groups, frames
├─────────────────┤
│  WebTransport   │  🌐 Browser-compatible QUIC
│      QUIC       │     - HTTP/3 handshake, multiplexing, etc.
└─────────────────┘
```

## Quick Start

**Requirements:**
- [Nix](https://nixos.org/download.html)
- [Direnv](https://direnv.net/)

Or if you don't like Nix, you can install dependencies manually:

- [Rust](https://www.rust-lang.org/tools/install)
- [Node.js](https://nodejs.org/)
- [Just](https://github.com/casey/just)
- [pnpm](https://pnpm.io/)
- `just setup`

**Run it:**
```sh
# Run everything (relay + demo + web server)
just all
```

Then visit [https://localhost:8080](https://localhost:8080) to see the demo.


## Libraries

This repository provides both **Rust** and **TypeScript** implementations with similar APIs but language-specific optimizations.

### Rust Libraries

| Crate                       | Description                     | Docs                                                                           |
|-----------------------------|---------------------------------|--------------------------------------------------------------------------------|
| **[moq-lite](rs/moq)**      | Core pub/sub transport protocol | [![docs.rs](https://docs.rs/moq-lite/badge.svg)](https://docs.rs/moq-lite)     |
| **[hang](rs/hang)**         | Media streaming components      | [![docs.rs](https://docs.rs/hang/badge.svg)](https://docs.rs/hang)             |
| [moq-relay](rs/moq-relay)   | Clusterable relay server        |                                                                                |
| [moq-native](rs/moq-native) | Helpers to configure QUIC       | [![docs.rs](https://docs.rs/moq-native/badge.svg)](https://docs.rs/moq-native) |
| [hang-cli](rs/hang-cli)     | Command-line media tools        |                                                                                |

**Example - Chat track:**
```rust
	// Optional: Use moq_native to make a QUIC client.
    let config = moq_native::ClientConfig::default(); // See documentation
	let client = moq_native::Client::new(config);

	// For local development, use: http://localhost:4443/
	// Feel free to use the `anon` path for testing; no authentication required.
	let url = url::Url::parse("https://relay.quic.video:443/anon/").unwrap();

	// Establish a WebTransport/QUIC connection.
	let connection = client.connect(url).await?;

	// Perform the MoQ handshake.
	let mut session = moq_lite::Session::connect(connection).await?;

	// Create a broadcast.
	// A broadcast is a collection of tracks, but in this example there's just one.
	let broadcast = moq_lite::BroadcastProducer::new();

	// Create a track that we'll insert into the broadcast.
	// A track is a series of groups representing a live stream.
	let track = broadcast.create(moq_lite::Track {
		name: "chat".to_string(),
		priority: 0,
	});

	// Create a group.
	// Each group is independent and the newest group(s) will be prioritized.
	let group = track.append_group();

	// Write frames to the group.
	// Each frame is dependent on the previous frame, so older frames are prioritized.
	group.append_frame(b"Hello");
	group.append_frame(b"World");

	// Finally, publish the broadcast to the session.
	// You can provide a broadcast path which gets appended to the URL.
	session.publish("my-broadcast", broadcast.consume());

	// NOTE: You can create multiple consumer instances of any `XxxProducer`
	// Each which will receive a (ref-counted) copy of the data.
	let _broadcast = broadcast.consume();
	let _track = track.consume();
	let _group = group.consume();
```


### TypeScript Libraries

| Package                        | Description                     | NPM                                                                                                   |
|--------------------------------|---------------------------------|-------------------------------------------------------------------------------------------------------|
| **[@kixelated/moq](js/moq)**   | Core pub/sub transport protocol | [![npm](https://img.shields.io/npm/v/@kixelated/moq)](https://www.npmjs.com/package/@kixelated/moq)   |
| **[@kixelated/hang](js/hang)** | Media streaming components      | [![npm](https://img.shields.io/npm/v/@kixelated/hang)](https://www.npmjs.com/package/@kixelated/hang) |

**Example - Web Components:**
```html
<script type="module">
	import "@kixelated/hang/publish/element";
	import "@kixelated/hang/watch/element";
</script>

<!-- Publish camera/microphone -->
<hang-publish url="https://relay.example.com/demo/alice" audio video controls>
	<!-- Optional: Add a video element to preview the stream locally -->
    <video muted autoplay></video>
</hang-publish>

<!-- Watch live stream -->
<hang-watch url="https://relay.example.com/demo/alice" controls>
	<!-- Optional: Add a canvas element to style it as you like -->
    <canvas style="border: 1px solid red;"></canvas>
</hang-watch>
```

**Example - Chat Track:**
```typescript
import { Connection } from "@kixelated/moq";

// Connect and discover streams
const conn = await Connection.connect("https://relay.example.com");
const announced = conn.announced("demo/");

for await (const announce of announced) {
    console.log("new broadcast:", announce.path);

    // Subscribe to stream
    const broadcast = conn.consume(announce.path);
    const track = broadcast.subscribe("chat");

    // Process media data
    for await (const group of track) {
        for await (const frame of group) {
            console.log("new frame:", frame.payload());
        }
    }
}
```

## Protocol Design
Read the specifications:
- [moq-lite](https://kixelated.github.io/moq-drafts/draft-lcurley-moq-lite.html)
- [hang](https://kixelated.github.io/moq-drafts/draft-lcurley-hang.html)
- [use-cases](https://kixelated.github.io/moq-drafts/draft-lcurley-moq-use-cases.html)


## Development

We use [Just](https://github.com/casey/just) as a slightly better `make`.

```sh
# See all available commands
just

# Build everything
just build

# Run tests and linting
just check

# Automatically fix some linting errors
just fix

# Run the demo manually
just relay    # Terminal 1: Start relay server
just pub bbb  # Terminal 2: Publish demo video
just web      # Terminal 3: Start web server
```


## License

Licensed under either:
-   Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
-   MIT license ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)
