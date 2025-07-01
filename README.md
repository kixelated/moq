![License](https://img.shields.io/badge/license-MIT%2FApache--2.0-blue)
[![Discord](https://img.shields.io/discord/1124083992740761730)](https://discord.gg/FCYF3p99mr)
[![Crates.io](https://img.shields.io/crates/v/moq-lite)](https://crates.io/crates/moq-lite)
[![npm](https://img.shields.io/npm/v/@kixelated/moq)](https://www.npmjs.com/package/@kixelated/moq)

<p align="center">
	<img height="128px" src="https://github.com/kixelated/moq/blob/main/.github/logo.svg" alt="Media over QUIC">
</p>

# Media over QUIC

[Media over QUIC](https://quic.video) (MoQ) is a next-generation live media delivery protocol that provides **real-time latency** at **massive scale**.
Built on modern web technologies like [WebTransport](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API) and [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API), MoQ delivers WebRTC-like latency with CDN-like distribution.

**Key Features:**
- 🚀 **Real-time latency** via QUIC stream priotization and partial reliability.
- 📈 **Massive scale** via edge caching, fanout, and multi-region clustering.
- 🌐 **Browser support** via WebTransport and WebCodecs.
- 🔧 **Generic transport** for any live data, not just media
- 🎯 **Simple API** with both Rust and TypeScript implementations

> **Note:** This project is a [fork](https://quic.video/blog/transfork) of the [IETF MoQ specification](https://datatracker.ietf.org/group/moq/documents/). The focus is narrower, focusing on simplicity and deployability.


## Architecture

MoQ is designed as a layered protocol stack.

**Rule 1**: The CDN MUST NOT know anything about your application, media codecs, or even the available tracks.
Everything could be fully E2EE and the CDN wouldn't care. **No business logic allowed**.

Instead, [`moq-relay`](rs/moq-relay) operates on rules encoded in the [`moq-lite`](https://docs.rs/moq-lite) header.
These rules are based on video encoding but are generic enough to be used for any live data.
The goal is to keep the server as dumb as possible while supporting a wide range of use-cases.

The media logic is split into another protocol called [`hang`](https://docs.rs/hang).
It's pretty simple and only intended to be used by clients or media servers.
If you want to do something more custom, then you can always extend it or replace it entirely.

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

## Setup
### Easy Mode
- [Nix](https://nixos.org/download.html)

```sh
# Runs a relay, demo media, and the web server
nix shell -c just all
```

Then visit [https://localhost:8080](https://localhost:8080) to see the demo.

### Easier Mode
- [Direnv](https://direnv.net/)

Then you'll no longer need to type `nix shell -c` before each command.
It will automatically apply the Nix shell when you change into the directory.

### Hard Mode
Or if you don't like Nix, you can install dependencies manually.

- [Rust](https://www.rust-lang.org/tools/install)
- [Node.js](https://nodejs.org/)
- [Just](https://github.com/casey/just)
- [pnpm](https://pnpm.io/)
- [FFmpeg](https://ffmpeg.org/download.html)
- [GStreamer](https://gstreamer.freedesktop.org/documentation/installing/index.html) (optional)
- ...probably some other stuff

**Run it:**
```sh
# Install some additional dependencies
just setup

# Runs a relay, demo media, and the web server
just all
```

Then visit [https://localhost:8080](https://localhost:8080) to see the demo.


## Libraries
This repository provides both [Rust](/rs) and [TypeScript](/js) libraries with similar APIs but language-specific optimizations.

### Rust
| Crate                       | Description                                                                                                                           | Docs                                                                           |
|-----------------------------|---------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------|
| [moq-lite](rs/moq)          | The core pub/sub transport protocol. Has built-in concurrency and deduplication.                                                      | [![docs.rs](https://docs.rs/moq-lite/badge.svg)](https://docs.rs/moq-lite)     |
| [moq-relay](rs/moq-relay)   | A clusterable relay server. This relay performs fan-out connecting multiple clients and servers together.                             |                                                                                |
| [moq-token](rs/moq-token)   | An authentication scheme supported by `moq-relay`. Can be used as a library or as [a CLI](rs/moq-token-cli) to authenticate sessions. |                                                                                |
| [moq-native](rs/moq-native) | Opinionated helpers to configure a Quinn QUIC endpoint. It's harder than it should be.                                                | [![docs.rs](https://docs.rs/moq-native/badge.svg)](https://docs.rs/moq-native) |
| [hang](rs/hang)             | Media-specific encoding/streaming layered on top of `moq-lite`. Can be used as a library or [a CLI](rs/hang-cli).                     | [![docs.rs](https://docs.rs/hang/badge.svg)](https://docs.rs/hang)             |
| [hang-gst](rs/hang-gst)     | A simple gstreamer plugin for publishing or consuming hang broadcasts.                                                                |                                                                                |
| [hang-wasm](rs/hang-wasm)   | A deprecated web player using WASM. Use the Typescript implementation instead.                                                        |                                                                                |


### TypeScript

| Package                                  | Description                                                                                                        | NPM                                                                                                   |
|------------------------------------------|--------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------|
| **[@kixelated/moq](js/moq)**             | The core pub/sub transport protocol. Has built-in concurrency and deduplication.                                   | [![npm](https://img.shields.io/npm/v/@kixelated/moq)](https://www.npmjs.com/package/@kixelated/moq)   |
| **[@kixelated/hang](js/hang)**           | Media-specific encoding/streaming layered on top of `moq-lite`. Provides both a Javascript API and Web Components. | [![npm](https://img.shields.io/npm/v/@kixelated/hang)](https://www.npmjs.com/package/@kixelated/hang) |
| **[@kixelated/hang-demo](js/hang-demo)** | Examples using `@kixelated/hang`.                                                                                  |                                                                                                       |


## Protocol
Read the specifications:
- [moq-lite](https://kixelated.github.io/moq-drafts/draft-lcurley-moq-lite.html)
- [hang](https://kixelated.github.io/moq-drafts/draft-lcurley-hang.html)
- [use-cases](https://kixelated.github.io/moq-drafts/draft-lcurley-moq-use-cases.html)


## Development
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
just pub tos  # Terminal 2: Publish a demo video using ffmpeg
just web      # Terminal 3: Start web server
```

There are more commands: check out the [Justfile](Justfile), [rs/Justfile](rs/Justfile), and [js/Justfile](js/Justfile).

## License

Licensed under either:
-   Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
-   MIT license ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)
