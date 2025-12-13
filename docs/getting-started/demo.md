---
title: Demo
description: Understanding the MoQ demo application
---

# Demo Application

The MoQ demo showcases live video streaming with real-time latency using the protocol stack.

## Overview

The demo consists of several components working together:

1. **Relay Server** (`moq-relay`) - Routes broadcasts between publishers and subscribers
2. **Media Publisher** (`hang-cli`) - Publishes video using FFmpeg
3. **Web Server** - Serves the demo web application
4. **Browser Client** - Consumes and displays the video stream

## Running Individual Components

Instead of running everything with `just dev`, you can run components separately for debugging:

### Terminal 1: Start the Relay

```bash
just relay
```

This starts the relay server that routes broadcasts between publishers and subscribers.

### Terminal 2: Publish Demo Video

```bash
just pub tos
```

This publishes the "Tears of Steel" demo video using FFmpeg and the `hang-cli` tool.

### Terminal 3: Start the Web Server

```bash
just web
```

This serves the demo web application on [https://localhost:8080](https://localhost:8080).

## Demo Features

The demo application includes:

- **Live Video Playback** - Real-time video with low latency
- **Text Chat** - Demonstrates non-media track usage
- **Quality Selection** - Adaptive bitrate streaming
- **Network Stats** - Real-time statistics display

## Understanding the Flow

### 1. Publisher Side

The `hang-cli` tool:
1. Reads video input (from FFmpeg)
2. Encodes using WebCodecs-compatible formats (H.264, Opus, etc.)
3. Splits into groups (typically aligned with keyframes)
4. Publishes groups as QUIC streams to the relay

### 2. Relay Server

The relay:
1. Accepts connections from publishers and subscribers
2. Routes broadcasts based on path-based authentication
3. Performs fan-out to multiple subscribers
4. Applies prioritization and backpressure rules

### 3. Subscriber Side

The browser client:
1. Connects to the relay via WebTransport
2. Subscribes to broadcast tracks
3. Decodes video/audio using WebCodecs
4. Renders to HTML5 elements

## Demo Videos

Several demo videos are available:

```bash
# Tears of Steel (default)
just pub tos

# Big Buck Bunny
just pub bbb

# Custom video file
just pub /path/to/video.mp4
```

## Web Components

The demo uses Web Components from `@moq/hang`:

```html
<!-- Video player component -->
<hang-video src="https://cdn.moq.dev/demo/tos"></hang-video>

<!-- Audio player component -->
<hang-audio src="https://cdn.moq.dev/demo/tos"></hang-audio>
```

See [Web Components](/typescript/web-components) for more details.

## Configuration

### Relay Configuration

The relay can be configured via `relay.toml`:

```toml
[server]
bind = "[::]:4443"  # Listen address

[auth]
public = "anon"     # Allow anonymous access to anon/**
key = "root.jwk"    # JWT key for authentication
```

See [Authentication](/guide/authentication) for details.

### Publisher Configuration

Customize encoding settings:

```bash
# Publish with custom bitrate
hang publish --bitrate 2000000 input.mp4

# Publish with custom codec
hang publish --codec h264 input.mp4
```

## Common Issues

### Certificate Warnings

The demo uses self-signed certificates for local development. Your browser will show a warning - this is expected. Click "Advanced" and proceed.

### Port Already in Use

If port 8080 or 4443 is already in use:

```bash
# Check what's using the port
lsof -i :8080
lsof -i :4443

# Kill the process or use different ports
```

### No Video Playback

Check browser console for errors. Common issues:

- **WebTransport not supported** - Use Chrome, Edge, or another Chromium-based browser
- **Connection refused** - Ensure the relay is running
- **No audio/video** - Check codec support in your browser

## Next Steps

- Learn about [core concepts](/getting-started/concepts)
- Understand the [architecture](/guide/architecture)
- Try building with [Rust](/rust/) or [TypeScript](/typescript/) libraries
- Deploy to production with [deployment guide](/guide/deployment)
