---
title: Installation
description: Detailed installation instructions for MoQ
---

# Installation

This guide covers different ways to install and set up MoQ for development.

## Using Nix (Recommended)

Nix provides a reproducible development environment with all dependencies managed for you.

### Install Nix

Follow the official [Nix installation guide](https://nixos.org/download.html):

```bash
# Single-user installation (macOS/Linux)
sh <(curl -L https://nixos.org/nix/install)
```

### Enable Flakes

Add the following to `~/.config/nix/nix.conf` (create it if it doesn't exist):

```
experimental-features = nix-command flakes
```

### Enter Development Environment

```bash
cd /path/to/moq
nix develop
```

This will download and set up all required dependencies.

### Optional: Use direnv

For automatic environment loading when entering the directory:

1. Install [direnv](https://direnv.net/) and [nix-direnv](https://github.com/nix-community/nix-direnv)
2. Create a `.envrc` file in the project root:

```bash
use flake
```

3. Allow direnv:

```bash
direnv allow
```

## Manual Installation

If you prefer not to use Nix, install these dependencies manually:

### 1. Install Just

[Just](https://github.com/casey/just) is a command runner similar to Make.

#### macOS

```bash
brew install just
```

#### Linux

```bash
# Using cargo
cargo install just

# Or use your package manager
# Arch Linux
sudo pacman -S just

# Ubuntu/Debian
sudo apt install just
```

### 2. Install Rust

Install Rust using [rustup](https://rustup.rs/):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### 3. Install Bun

[Bun](https://bun.sh/) is a fast JavaScript runtime and package manager.

```bash
curl -fsSL https://bun.sh/install | bash
```

### 4. Install FFmpeg

FFmpeg is required for media processing.

#### macOS

```bash
brew install ffmpeg
```

#### Linux

```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# Arch Linux
sudo pacman -S ffmpeg
```

### 5. Install Project Dependencies

```bash
cd /path/to/moq
just install
```

## Verify Installation

Check that all tools are installed:

```bash
just --version
rustc --version
bun --version
ffmpeg -version
```

## Development Commands

Once installed, you can use these commands:

```bash
# Run the demo
just dev

# Build everything
just build

# Run tests and linting
just check

# Auto-fix linting errors
just fix
```

See all available commands:

```bash
just
```

## IDE Setup

### VS Code

Recommended extensions:

- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer) - Rust language support
- [Biome](https://marketplace.visualstudio.com/items?itemName=biomejs.biome) - JavaScript/TypeScript linting and formatting

### Other Editors

The project uses:

- **Rust**: Standard Rust tooling (rust-analyzer, rustfmt, clippy)
- **TypeScript**: Biome for linting and formatting (configured in `biome.jsonc`)

## Troubleshooting

### Nix: Command not found after installation

Restart your shell or run:

```bash
source ~/.nix-profile/etc/profile.d/nix.sh
```

### Rust: cargo command not found

Add Rust to your PATH:

```bash
source $HOME/.cargo/env
```

### Bun: Permission denied

Ensure the bun installation directory is in your PATH:

```bash
export PATH="$HOME/.bun/bin:$PATH"
```

Add this to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.) to make it permanent.

## Next Steps

- [Run the demo](/getting-started/demo)
- Learn about [core concepts](/getting-started/concepts)
- Explore the [architecture](/guide/architecture)
