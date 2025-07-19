# MoQ Documentation

Welcome to the Media over QUIC (MoQ) documentation. MoQ is a next-generation live media delivery protocol that provides real-time latency at massive scale.

## Quick Start

- **Setup**: Run `just setup` to install dependencies
- **Development**: Run `just dev` for full development environment
- **Demo**: Check out the [demo](../js/hang-demo) for working examples

## Documentation

### Core Concepts

- **[Authentication](auth.md)** - JWT tokens, path-based authorization, and security

### Architecture

The project follows a layered protocol stack:

1. **moq-lite** (core pub/sub transport) - Generic broadcast/track/group/frame protocol
2. **hang** (media layer) - Media-specific encoding/streaming with codec support  
3. **Application layer** - Business logic, authentication, catalog

### Components

#### Rust (`/rs`)
- **[moq](../rs/moq)** - Core protocol implementation (published as `moq-lite`)
- **[moq-relay](../rs/moq-relay)** - Clusterable relay server
- **[moq-token](../rs/moq-token)** - JWT authentication library
- **[hang](../rs/hang)** - Media encoding/streaming
- **[hang-cli](../rs/hang-cli)** - CLI tool for media operations (binary: `hang`)

#### TypeScript (`/js`)
- **[moq](../js/moq)** - Core protocol for browsers (published as `@kixelated/moq`)
- **[hang](../js/hang)** - Media layer with Web Components (published as `@kixelated/hang`)
- **[hang-demo](../js/hang-demo)** - Demo applications
- **[moq-token](../js/moq-token)** - Token generation and validation
- **[signals](../js/signals)** - Reactive signals library

## Development

- **Testing**: Run `just check` for all tests and linting
- **Building**: Run `just build` for all packages
- **Linting**: Run `just fix` to auto-fix issues

## Key Concepts

- **Session**: A QUIC/WebTransport connection for publishing or subscribing
- **Broadcasts**: Discoverable collections of tracks
- **Tracks**: Named streams of data, split into groups
- **Groups**: Sequential collection of frames (usually start with keyframe)
- **Frames**: Timed chunks of data

## Resources

- [Main Repository](https://github.com/kixelated/moq)
- [Project Website](https://quic.video)
- [Discord Community](https://discord.gg/FCYF3p99mr)
- [NPM Package](https://www.npmjs.com/package/@kixelated/moq)
- [Crates.io Package](https://crates.io/crates/moq-lite)

## Contributing

See the main [README](../README.md) for contribution guidelines and the [CLAUDE.md](../CLAUDE.md) file for AI assistant guidance.