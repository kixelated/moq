# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MoQ (Media over QUIC) is a next-generation live media delivery protocol providing real-time latency at massive scale. It's a polyglot monorepo with Rust (server/native) and TypeScript/JavaScript (browser) implementations.

## Common Development Commands

```bash
# Setup and install dependencies
just setup

# Run full development environment (relay + demo media + web server)
just dev

# Run individual components
just relay        # Run localhost relay server
just cluster      # Run cluster of relay servers

# Code quality and testing
just check        # Run all tests and linting
just fix          # Auto-fix linting issues
just build        # Build all packages
```

## Architecture

The project follows a layered protocol stack:

1. **moq-lite** (core pub/sub transport) - Generic broadcast/track/group/frame protocol
2. **hang** (media layer) - Media-specific encoding/streaming with codec support
3. **Application layer** - Business logic, authentication, catalog

Key architectural rule: The CDN/relay must not know about application logic, media codecs, or track details. All media logic is handled in the `hang` layer. `hang` should still be generic enough that an application can build a custom UI on top of it. For example, it can be used to access individual frames if the application wants to perform custom rendering.

## Project Structure

```
/rs/               # Rust crates
  moq/            # Core protocol (published as moq-lite)
  moq-relay/      # Clusterable relay server
  moq-token/      # JWT authentication
  hang/           # Media encoding/streaming
  hang-cli/       # CLI tool for media operations (binary is named `hang`)

/js/               # TypeScript/JavaScript packages
  moq/             # Core protocol for browsers (published as @kixelated/moq)
  hang/            # Media layer with Web Components (published as @kixelated/hang)
  hang-demo/       # Demo applications
```

## Development Tips

1. The project uses `just` as the task runner - check `justfile` for all available commands
2. For Rust development, the workspace is configured in the `rs/Cargo.toml`
3. For JS/TS development, pnpm workspaces are used with configuration in `js/pnpm-workspace.yaml`
4. Try to keep stuff out of the root unless necessary; scope tools to specific languages.
5. The demo runs on https://localhost:8080 with self-signed certificates

## Key Concepts

- **Session**: A QUIC/WebTransport connection that can be used to publish or subscribe.
- **Broadcasts**: Discoverable collections of tracks.
- **Tracks**: Named streams of data, split into groups
- **Groups**: Sequential collection of frames (usually start with keyframe)
- **Frames**: Timed chunks of data.

## Testing Approach

- Run `just check` to execute all tests and linting
- Rust tests are integrated within source files
