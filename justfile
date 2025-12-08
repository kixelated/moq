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
	cd rs && just install
	cd js && just install

# Alias for dev.
all: dev

# Run the relay, web server, and publish bbb.
dev:
	# We use bun for concurrently, so make sure it's installed.
	cd js && just install

	# Build the rust packages so `cargo run` has a head start.
	cd rs && just build

	# Then run the relay with a slight head start.
	# It doesn't matter if the web beats BBB because we support automatic reloading.
	js/node_modules/.bin/concurrently --kill-others --names srv,bbb,web --prefix-colors auto \
		"just relay" \
		"sleep 1 && just pub bbb http://localhost:4443/anon" \
		"sleep 2 && just web http://localhost:4443/anon"

# Run a localhost relay server
relay:
	cd rs && just relay

# Run a cluster of relay servers
cluster:
	# We use bun for concurrently, so make sure it's installed.
	cd js && just install

	# Generate auth tokens if needed
	@cd rs && just auth-token

	# Build the rust packages so `cargo run` has a head start.
	cd rs && just build

	# Then run a BOATLOAD of services to make sure they all work correctly.
	# Publish the funny bunny to the root node.
	# Publish the robot fanfic to the leaf node.
	js/node_modules/.bin/concurrently --kill-others --names root,leaf,bbb,tos,web --prefix-colors auto \
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

# Ingest a live HLS media playlist and publish it via hang (full ladder).
# Thin wrapper around the Rust justfile recipe.
ingest-hls url name='demo' relay='http://localhost:4443/anon':
	cd rs && just ingest-hls {{url}} {{name}} {{relay}}

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
	cd js && just dev {{url}}

# Publish the clock broadcast
# `action` is either `publish` or `subscribe`
clock action url="http://localhost:4443/anon" *args:
	cd rs && just clock {{action}} {{url}} {{args}}

# Run the CI checks
check:
	cd rs && just check
	cd js && just check

# Run the unit tests
test:
	cd rs && just test
	cd js && just test

# Automatically fix some issues.
fix:
	cd rs && just fix
	cd js && just fix

# Upgrade any tooling
upgrade:
	cd rs && just upgrade
	cd js && just upgrade

# Build the packages
build:
	cd rs && just build
	cd js && just build
