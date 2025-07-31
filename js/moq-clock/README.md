# MoQ Clock

A TypeScript/JavaScript implementation of the MoQ clock example that's compatible with the Rust `moq-clock` implementation. This demonstrates real-time timestamp broadcasting using the MoQ (Media over QUIC) protocol.

## Overview

This package provides a clock broadcast system where:
- **Publishers** send timestamp data organized by minute-based groups  
- **Subscribers** receive and display live timestamps
- Wire format is compatible with the Rust `moq-clock` implementation
- Uses the same group/frame structure as the Rust version for interoperability

## Wire Format Compatibility

The TypeScript implementation matches the Rust wire format exactly:

1. **Groups**: Each group represents one minute of data
2. **Base Frame**: First frame contains the timestamp base (e.g., "2025-01-31 14:23:")
3. **Second Frames**: Subsequent frames contain individual seconds (e.g., "00", "01", "02", ...)

This means you can:
- Publish with TypeScript and subscribe with Rust
- Publish with Rust and subscribe with TypeScript  
- Mix and match implementations seamlessly

## Installation & Setup

From the `js/moq-clock` directory:

```bash
# Install dependencies (run from js/ root)
pnpm install

# Make the script executable
chmod +x src/main.ts
```

## Usage

### Command Line Interface

The TypeScript implementation mirrors the Rust CLI interface:

```bash
# Publish a clock broadcast
./src/main.ts --url https://relay.example.com --broadcast myclock --track seconds publish

# Subscribe to a clock broadcast  
./src/main.ts --url https://relay.example.com --broadcast myclock --track seconds subscribe

# Using environment variables
MOQ_URL=https://relay.example.com MOQ_NAME=myclock ./src/main.ts publish
MOQ_URL=https://relay.example.com MOQ_NAME=myclock ./src/main.ts subscribe

# Get help
./src/main.ts --help
```

### Options

- `--url <URL>`: Connect to the given URL starting with https://
- `--broadcast <NAME>`: The name of the broadcast to publish or subscribe to
- `--track <NAME>`: The name of the clock track (default: "seconds")
- `-h, --help`: Show help information

### Environment Variables

- `MOQ_URL`: Default URL to connect to
- `MOQ_NAME`: Default broadcast name

## Interoperability with Rust

### Same Relay, Different Languages

You can run the TypeScript publisher and Rust subscriber (or vice versa) against the same relay:

```bash
# Terminal 1: Start TypeScript publisher
cd js/moq-clock
./src/main.ts --url https://localhost:8080 --broadcast clock publish

# Terminal 2: Start Rust subscriber  
cd rs/moq-clock
cargo run -- --url https://localhost:8080 --broadcast clock subscribe
```

### Testing Compatibility

1. **Start the MoQ relay**:
   ```bash
   just relay
   ```

2. **Test TypeScript ↔ Rust compatibility**:
   ```bash
   # Option A: TS publish, Rust subscribe
   cd js/moq-clock && ./src/main.ts --url https://localhost:8080 --broadcast test publish
   cd rs/moq-clock && cargo run -- --url https://localhost:8080 --broadcast test subscribe
   
   # Option B: Rust publish, TS subscribe  
   cd rs/moq-clock && cargo run -- --url https://localhost:8080 --broadcast test publish
   cd js/moq-clock && ./src/main.ts --url https://localhost:8080 --broadcast test subscribe
   ```

3. **Expected output**: Both implementations should display timestamps in the format `YYYY-MM-DD HH:MM:SS`

## Package Scripts

```bash
# Type check
pnpm check

# Build  
pnpm build

# Quick publish (uses default env vars)
pnpm publish

# Quick subscribe (uses default env vars) 
pnpm subscribe
```

## Architecture Notes

### Group Structure
- Each minute gets its own group with an incrementing sequence number
- Groups contain a base timestamp frame followed by individual second frames
- This allows efficient caching and subscription to any point in time

### Broadcast Organization
- **Broadcast**: Named collection of tracks (e.g., "myclock")  
- **Track**: Named stream within broadcast (e.g., "seconds")
- **Groups**: Time-based segments within a track (per minute)
- **Frames**: Individual data chunks within a group (per second)

### Timing Behavior
- Publisher aligns to minute boundaries and publishes in real-time
- Subscriber receives data as it's published
- Both implementations handle clock drift and timing edge cases

## Development

The implementation closely follows the Rust version in `rs/moq-clock/` for maximum compatibility. Key design decisions:

1. **Wire Format**: Identical binary encoding using UTF-8 strings
2. **Timing**: Same minute-based grouping and second-based framing  
3. **CLI Interface**: Matching command-line arguments and behavior
4. **Error Handling**: Similar patterns for connection and subscription errors

## Dependencies

- `@kixelated/moq`: Core MoQ protocol implementation for browsers/Node.js
- Deno runtime for TypeScript execution with WebTransport support

## Integration with Existing Examples

This replaces the separate `js/moq/examples/publish.ts` and `js/moq/examples/subscribe.ts` files with a single, more capable implementation that matches the Rust tooling patterns used throughout the project.