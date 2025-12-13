---
title: Development Setup
description: Setting up your development environment
---

# Development Setup

This guide covers setting up your development environment for contributing to MoQ.

## Prerequisites

Choose one of the following installation methods:

### Option 1: Nix (Recommended)

The easiest way to get all dependencies:

```bash
# Install Nix
sh <(curl -L https://nixos.org/nix/install)

# Enable flakes (add to ~/.config/nix/nix.conf)
echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf

# Enter development environment
cd /path/to/moq
nix develop
```

### Option 2: Manual Installation

Install dependencies individually:

- [Just](https://github.com/casey/just) - Command runner
- [Rust](https://rustup.rs/) - Rust toolchain
- [Bun](https://bun.sh/) - JavaScript runtime
- [FFmpeg](https://ffmpeg.org/) - Media processing (for demos)

See [Installation guide](/getting-started/installation) for detailed instructions.

## Getting the Code

```bash
# Fork the repository on GitHub first, then:
git clone https://github.com/YOUR-USERNAME/moq
cd moq

# Add upstream remote
git remote add upstream https://github.com/moq-dev/moq
```

## Project Structure

```
moq/
├── rs/              # Rust workspace
│   ├── moq-lite/   # Core protocol
│   ├── hang/       # Media library
│   ├── moq-relay/  # Relay server
│   └── ...         # Other crates
├── js/              # JavaScript/TypeScript workspace
│   ├── lite/       # @moq/lite
│   ├── hang/       # @moq/hang
│   ├── hang-demo/  # Demo app
│   └── ...         # Other packages
├── docs/            # Documentation site
├── cdn/             # Deployment configs
├── justfile         # Root task runner
├── biome.jsonc      # JS linting config
└── flake.nix        # Nix development environment
```

## Development Commands

All commands use [Just](https://github.com/casey/just):

### Common Commands

```bash
# List all available commands
just

# Install dependencies
just install

# Build everything
just build

# Run tests and linting
just check

# Auto-fix linting errors
just fix

# Run the demo
just dev
```

### Rust-Specific

```bash
# Enter Rust directory
cd rs

# Build Rust packages
just build

# Run tests
just test

# Run linting
just clippy

# Format code
just fmt
```

### TypeScript-Specific

```bash
# Enter JavaScript directory
cd js

# Install dependencies
just install

# Build packages
just build

# Run tests
just test

# Run demo
just dev
```

### Documentation

```bash
# Serve docs locally
just docs

# Build docs
just docs-build

# Deploy docs
just docs-deploy
```

## Running the Demo

The demo runs a relay, publishes test video, and serves a web app:

```bash
# Run everything
just dev

# Or run components separately:

# Terminal 1: Relay server
just relay

# Terminal 2: Publish demo video
just pub bbb

# Terminal 3: Web server
just web
```

Then visit [https://localhost:8080](https://localhost:8080).

## Code Quality

### Rust

Formatting and linting:

```bash
cd rs

# Format code
cargo fmt

# Run linting
cargo clippy

# Fix auto-fixable issues
cargo clippy --fix

# Or use just commands
just fmt
just clippy
just fix
```

### TypeScript

Using Biome:

```bash
cd js

# Check formatting and linting
bun run check

# Auto-fix issues
bun run fix

# Or use just commands
just check
just fix
```

## Testing

### Rust Tests

```bash
cd rs

# Run all tests
cargo test

# Run tests for a specific crate
cargo test -p moq-lite

# Run with output
cargo test -- --nocapture
```

### TypeScript Tests

```bash
cd js

# Run tests
bun test

# Watch mode
bun test --watch
```

## Debugging

### Rust

Use logging with `RUST_LOG`:

```bash
# Info level
RUST_LOG=info cargo run --bin moq-relay

# Debug level
RUST_LOG=debug cargo run --bin moq-relay

# Specific module
RUST_LOG=moq_relay=trace cargo run --bin moq-relay
```

### TypeScript

Use browser DevTools:

1. Open demo in Chrome
2. Press F12 for DevTools
3. Check Console for logs
4. Use Network tab for WebTransport

## IDE Setup

### VS Code

Recommended extensions:

- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
- [Biome](https://marketplace.visualstudio.com/items?itemName=biomejs.biome)

Workspace settings (`.vscode/settings.json`):

```json
{
    "editor.formatOnSave": true,
    "rust-analyzer.checkOnSave.command": "clippy"
}
```

### Other Editors

- **Rust**: Use rust-analyzer LSP
- **TypeScript**: Use Biome LSP or TypeScript language server

## Working with Git

### Branching

```bash
# Create a feature branch
git checkout -b feature/my-feature

# Keep your branch up to date
git fetch upstream
git rebase upstream/main
```

### Committing

```bash
# Stage changes
git add .

# Commit with clear message
git commit -m "Add support for VP9 codec"

# Push to your fork
git push origin feature/my-feature
```

### Opening Pull Requests

1. Push your branch to your fork
2. Open a PR on GitHub
3. Describe your changes
4. Wait for review
5. Address feedback
6. Squash commits if requested

## Common Issues

### Nix: Command not found

Restart your shell or run:

```bash
source ~/.nix-profile/etc/profile.d/nix.sh
```

### Rust: Compilation errors

Update Rust:

```bash
rustup update
```

### Bun: Permission denied

Add bun to PATH:

```bash
export PATH="$HOME/.bun/bin:$PATH"
```

### Tests failing

Ensure dependencies are installed:

```bash
just install
```

## Environment Variables

Useful environment variables:

```bash
# Rust logging
export RUST_LOG=info

# Rust backtrace
export RUST_BACKTRACE=1

# Rust build jobs (parallel compilation)
export CARGO_BUILD_JOBS=8
```

## Performance Tips

### Rust Builds

```bash
# Use mold linker (faster linking)
cargo install -f cargo-binutils
rustup component add llvm-tools-preview

# Or use lld
# Add to ~/.cargo/config.toml:
[target.x86_64-unknown-linux-gnu]
linker = "clang"
rustflags = ["-C", "link-arg=-fuse-ld=lld"]
```

### TypeScript Builds

Bun is already very fast, but you can:

```bash
# Use --watch mode for dev
bun run dev --watch
```

## Next Steps

- Read the [Contributing guidelines](/contributing/)
- Check [open issues](https://github.com/moq-dev/moq/issues)
- Join [Discord](https://discord.gg/FCYF3p99mr)
- Read the [Architecture guide](/guide/architecture)
