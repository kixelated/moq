#!/usr/bin/env just --justfile

# Using Just: https://github.com/casey/just?tab=readme-ov-file#installation

# These commands have been split into separate files for each language.
# This is just a shim that uses the relevant file or calls both.

set quiet

# List all of the available commands.
default:
  just --list

# Install any dependencies.
install:
	bun install

# Alias for dev.
all: dev

# Run the relay, web server, and publish bbb.
dev:
	# Install any JS dependencies.
	bun install

	# Build the rust packages so `cargo run` has a head start.
	cd rs && just build

	# Then run the relay with a slight head start.
	# It doesn't matter if the web beats BBB because we support automatic reloading.
	bun run concurrently --kill-others --names srv,bbb,web --prefix-colors auto \
		"just relay" \
		"sleep 1 && just pub bbb http://localhost:4443/anon" \
		"sleep 2 && just web http://localhost:4443/anon"

# Run a localhost relay server
relay:
	cd rs && just relay

# Run a cluster of relay servers
cluster:
	# Generate auth tokens if needed
	@cd rs && just auth-token

	# Build the rust packages so `cargo run` has a head start.
	cd rs && just build

	# Then run a BOATLOAD of services to make sure they all work correctly.
	# Publish the funny bunny to the root node.
	# Publish the robot fanfic to the leaf node.
	node_modules/.bin/concurrently --kill-others --names root,leaf,bbb,tos,web --prefix-colors auto \
		"just root" \
		"sleep 1 && just leaf" \
		"sleep 2 && just pub bbb http://localhost:4444/demo?jwt=$(cat rs/dev/demo-cli.jwt)" \
		"sleep 3 && just pub tos http://localhost:4443/demo?jwt=$(cat rs/dev/demo-cli.jwt)" \
		"sleep 4 && just web http://localhost:4443/demo?jwt=$(cat rs/dev/demo-web.jwt)"

# Run a root node, accepting connections from leaf nodes.
root:
	cd rs && just root

# Run a leaf node, connecting to the root node.
leaf:
	cd rs && just leaf

# Publish a video using ffmpeg to the localhost relay server
pub name url='http://localhost:4443/anon' *args:
	cd rs && just pub {{name}} {{url}} {{args}}

# Publish/subscribe using gstreamer - see https://github.com/kixelated/hang-gst
pub-gst name url='http://localhost:4443/anon':
	@echo "GStreamer plugin has moved to: https://github.com/kixelated/hang-gst"
	@echo "Install and use hang-gst directly for GStreamer functionality"

# Subscribe to a video using gstreamer - see https://github.com/kixelated/hang-gst
sub name url='http://localhost:4443/anon':
	@echo "GStreamer plugin has moved to: https://github.com/kixelated/hang-gst"
	@echo "Install and use hang-gst directly for GStreamer functionality"

# Publish a video using ffmpeg directly from hang to the localhost
serve name:
	cd rs && just serve {{name}}

# Run the web server
web url='http://localhost:4443/anon':
	VITE_RELAY_URL="{{url}}" bun run --filter='*' dev

# Publish the clock broadcast
# `action` is either `publish` or `subscribe`
clock action url="http://localhost:4443/anon" *args:
	cd rs && just clock {{action}} {{url}} {{args}}

# Run the CI checks
check:
	#!/usr/bin/env bash
	set -euo pipefail

	# Run the Javascript checks.
	bun install --frozen-lockfile
	if tty -s; then
		bun run --filter='*' --elide-lines=0 check
	else
		bun run --filter='*' check
	fi
	bun biome check

	# Run the (slower) Rust checks.
	cd rs && just check

	# Only run the tofu checks if tofu is installed and cdn dir exists.
	if command -v tofu &> /dev/null && [ -d cdn ]; then cd cdn && just check; fi


# Run the unit tests
test:
	#!/usr/bin/env bash
	set -euo pipefail

	# Run the Javascript tests.
	bun install --frozen-lockfile
	if tty -s; then
		bun run --filter='*' --elide-lines=0 test
	else
		bun run --filter='*' test
	fi

	cd rs && just test

# Automatically fix some issues.
fix:
	# Fix the Javascript dependencies.
	bun install
	bun biome check --write
	bun run --filter='*' fix

	cd rs && just fix
	if command -v tofu &> /dev/null; then cd cdn && just fix; fi

# Upgrade any tooling
upgrade:
	bun update
	bun outdated

	cd rs && just upgrade

# Build the packages
build:
	bun run --filter='*' build

	cd rs && just build
