---
title: Rust API Reference
description: API documentation for Rust libraries
---

# Rust API Reference

Complete API documentation for all Rust crates is hosted on [docs.rs](https://docs.rs).

## Core Libraries

### moq-lite

[![docs.rs](https://docs.rs/moq-lite/badge.svg)](https://docs.rs/moq-lite)

**[docs.rs/moq-lite →](https://docs.rs/moq-lite)**

Core pub/sub transport protocol.

**Key types:**
- `Connection` - Connection to a relay
- `BroadcastProducer` / `BroadcastConsumer` - Publish/subscribe to broadcasts
- `Track` - Named stream within a broadcast
- `Group` - Collection of frames
- `Frame` - Individual data chunk

### hang

[![docs.rs](https://docs.rs/hang/badge.svg)](https://docs.rs/hang)

**[docs.rs/hang →](https://docs.rs/hang)**

Media-specific encoding/streaming library.

**Key types:**
- `Broadcast` - Media broadcast with catalog
- `Catalog` - Track metadata
- `VideoConfig` / `AudioConfig` - Track configuration
- `Frame` - Timestamp + codec bitstream
- `cmaf` module - CMAF/fMP4 import

## Server Tools

### moq-relay

Relay server - no library API, binary only.

See [moq-relay documentation](/rust/moq-relay) for configuration and usage.

### moq-token

[![docs.rs](https://docs.rs/moq-token/badge.svg)](https://docs.rs/moq-token)

**[docs.rs/moq-token →](https://docs.rs/moq-token)**

JWT authentication library.

**Key types:**
- `Token` - JWT token representation
- `Signer` - Token signing
- `Verifier` - Token verification

## Utilities

### moq-native

[![docs.rs](https://docs.rs/moq-native/badge.svg)](https://docs.rs/moq-native)

**[docs.rs/moq-native →](https://docs.rs/moq-native)**

QUIC endpoint configuration helpers.

**Key functions:**
- `configure_client` - Client endpoint setup
- `configure_server` - Server endpoint setup
- Certificate management utilities

### libmoq

[![docs.rs](https://docs.rs/libmoq/badge.svg)](https://docs.rs/libmoq)

**[docs.rs/libmoq →](https://docs.rs/libmoq)**

C bindings for `moq-lite` via FFI.

## Examples

- [Rust examples](/rust/examples) - Code examples
- [moq-lite crate examples](https://github.com/moq-dev/moq/tree/main/rs/moq-lite/examples)
- [hang crate examples](https://github.com/moq-dev/moq/tree/main/rs/hang/examples)

## Source Code

All source code is on [GitHub](https://github.com/moq-dev/moq):

- [rs/moq-lite](https://github.com/moq-dev/moq/tree/main/rs/moq-lite)
- [rs/hang](https://github.com/moq-dev/moq/tree/main/rs/hang)
- [rs/moq-relay](https://github.com/moq-dev/moq/tree/main/rs/moq-relay)
- [rs/moq-token](https://github.com/moq-dev/moq/tree/main/rs/moq-token)

## Contributing

See the [Contributing guide](/contributing/) for how to contribute to the Rust libraries.
