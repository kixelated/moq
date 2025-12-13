---
layout: home

hero:
  name: MoQ
  text: Media over QUIC
  tagline: Real-time latency at massive scale
  image:
    src: /logo.svg
    alt: Media over QUIC
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/
    - theme: alt
      text: View on GitHub
      link: https://github.com/moq-dev/moq

features:
  - icon: 🚀
    title: Real-time Latency
    details: Using QUIC for prioritization and partial reliability, MoQ delivers WebRTC-like latency without the constraints.

  - icon: 📈
    title: Massive Scale
    details: Designed for fan-out with support for cross-region clustering. Built to handle millions of concurrent viewers.

  - icon: 🌐
    title: Modern Browser Support
    details: Uses WebTransport, WebCodecs, and WebAudio APIs for native browser compatibility without plugins.

  - icon: 🎯
    title: Multi-language
    details: Both Rust (native) and TypeScript (web) libraries with similar APIs and language-specific optimizations.

  - icon: 🔧
    title: Generic Protocol
    details: Not just for media - use for any live data. Includes text chat as both an example and a core feature.

  - icon: 🏗️
    title: Layered Architecture
    details: Clean separation between transport (moq-lite) and media (hang) layers. CDN stays media-agnostic.
---

## What is MoQ?

[Media over QUIC](https://moq.dev) (MoQ) is a next-generation live media protocol that provides **real-time latency** at **massive scale**. Built using modern web technologies, MoQ delivers WebRTC-like latency without the constraints of WebRTC. The core networking is delegated to a QUIC library but the rest is in application-space, giving you full control over your media pipeline.

This project is a [fork](https://moq.dev/blog/transfork) of the [IETF MoQ specification](https://datatracker.ietf.org/group/moq/documents/), focusing on simplicity and deployability.

## Quick Start

Get up and running in minutes with Nix:

```bash
# Runs a relay, demo media, and the web server
nix develop -c just dev
```

Then visit [https://localhost:8080](https://localhost:8080) to see the demo.

See the [Getting Started guide](/getting-started/) for detailed installation instructions.

## Architecture

MoQ is designed as a layered protocol stack where the CDN knows nothing about your application, media codecs, or available tracks.

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

Learn more about the [architecture](/guide/architecture) and [protocol](/guide/protocol).

## Libraries

This repository provides both Rust and TypeScript libraries:

### Rust Libraries

- **[moq-lite](/rust/moq-lite)** - Core pub/sub transport protocol
- **[hang](/rust/hang)** - Media-specific encoding/streaming
- **[moq-relay](/rust/moq-relay)** - Clusterable relay server
- **[moq-token](https://docs.rs/moq-token)** - Authentication library

[View all Rust libraries →](/rust/)

### TypeScript Libraries

- **[@moq/lite](/typescript/lite)** - Core protocol for browsers
- **[@moq/hang](/typescript/hang)** - Media library with Web Components
- **[@moq/hang-ui](https://www.npmjs.com/package/@moq/hang-ui)** - UI components using SolidJS

[View all TypeScript libraries →](/typescript/)

## Community

- [GitHub](https://github.com/moq-dev/moq) - Source code and issues
- [Discord](https://discord.gg/FCYF3p99mr) - Community discussions
- [moq.dev](https://moq.dev) - Project website and blog
