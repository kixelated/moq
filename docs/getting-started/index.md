---
title: Quick Start
description: Get started with MoQ in minutes
---

# Quick Start

Get up and running with MoQ in just a few minutes. This guide will walk you through setting up the demo application.

## Prerequisites

Choose one of the following installation methods:

### Option 1: Using Nix (Recommended)

The simplest way to get started is with [Nix](https://nixos.org/download.html):

- [Nix](https://nixos.org/download.html)
- [Nix Flakes enabled](https://nixos.wiki/wiki/Flakes)

### Option 2: Manual Installation

If you prefer not to use Nix, install these dependencies:

- [Just](https://github.com/casey/just)
- [Rust](https://www.rust-lang.org/tools/install)
- [Bun](https://bun.sh/)
- [FFmpeg](https://ffmpeg.org/download.html)

See the [Installation guide](/getting-started/installation) for detailed setup instructions.

## Running the Demo

### With Nix

```bash
# Enter the development environment and run the demo
nix develop -c just dev
```

If you've installed [nix-direnv](https://github.com/nix-community/nix-direnv), you can simply run:

```bash
just dev
```

### Without Nix

```bash
# Install additional dependencies
just install

# Run the demo (relay, media server, and web server)
just dev
```

## Access the Demo

Once the demo is running, visit [https://localhost:8080](https://localhost:8080) in your browser.

::: warning
The demo uses an insecure HTTP fetch for local development only. In production, you'll need a proper domain and TLS certificate via [LetsEncrypt](https://letsencrypt.org/docs/) or similar.
:::

## What's Running?

The `just dev` command starts three components:

1. **Relay Server** - Routes live data between publishers and subscribers
2. **Demo Media** - Publishes sample video content
3. **Web Server** - Serves the demo application

## Next Steps

- Learn about [Core Concepts](/getting-started/concepts) - broadcasts, tracks, groups, and frames
- Explore the [Demo](/getting-started/demo) in detail
- Understand the [Architecture](/guide/architecture)
- Try the [Rust](/rust/) or [TypeScript](/typescript/) libraries
