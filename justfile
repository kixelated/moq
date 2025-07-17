#!/usr/bin/env just --justfile

# Using Just: https://github.com/casey/just?tab=readme-ov-file#installation

# These commands have been split into separate files for each language.
# This is just a shim that uses the relevant file or calls both.

set quiet

# List all of the available commands.
default:
  just --list

# Install any required dependencies.
setup:
	just --justfile rs/justfile setup

# Alias for dev.
all: dev

# Run the relay, web server, and publish bbb.
dev:
	# We use pnpm for concurrently, unfortunately, so make sure it's installed.
	cd js && pnpm i

	# Then run the relay with a slight head start.
	# It doesn't matter if the web beats BBB because we support automatic reloading.
	js/node_modules/.bin/concurrently --kill-others --names srv,bbb,web --prefix-colors auto \
		"just relay" \
		"sleep 1 && just pub bbb" \
		"sleep 2 && just web"

# Run a localhost relay server
relay:
	just --justfile rs/justfile relay

# Run a cluster of relay servers
cluster:
	# We use pnpm for concurrently, unfortunately, so make sure it's installed.
	cd js && pnpm i

	# Then run a BOATLOAD of services to make sure they all work correctly.
	# Publish the funny bunny to the root node.
	# Publish the robot fanfic to the leaf node.
	js/node_modules/.bin/concurrently --kill-others --names root,leaf,bbb,tos,web --prefix-colors auto \
		"just relay" \
		"sleep 1 && just leaf" \
		"sleep 2 && just pub bbb http://localhost:4443/" \
		"sleep 3 && just pub tos http://localhost:4444/" \
		"sleep 4 && just web"

# Run a leaf node
leaf:
	just --justfile rs/justfile leaf

# Publish a video using ffmpeg to the localhost relay server
pub name url='http://localhost:4443/':
	just --justfile rs/justfile pub {{name}} {{url}}

# Publish a video using gstreamer to the localhost relay server
pub-gst name url='http://localhost:4443/':
	just --justfile rs/justfile pub-gst {{name}} {{url}}

# Subscribe to a video using gstreamer
sub name url='http://localhost:4443/':
	just --justfile rs/justfile sub {{name}} {{url}}

# Publish a video using ffmpeg directly from hang to the localhost
serve name:
	just --justfile rs/justfile serve {{name}}

# Run the web server
web:
	just --justfile js/justfile web

# Publish the clock broadcast
# `action` is either `publish` or `subscribe`
clock action:
	just --justfile rs/justfile clock {{action}}

# Run the CI checks
check flags="":
	just --justfile rs/justfile check {{flags}}
	just --justfile js/justfile check
	@if which nix > /dev/null; then nix fmt -- --fail-on-change; else echo "nix not found, skipping Nix formatting check"; fi

# Automatically fix some issues.
fix flags="":
	just --justfile rs/justfile fix {{flags}}
	just --justfile js/justfile fix
	@if which nix > /dev/null; then nix fmt; else echo "nix not found, skipping Nix formatting"; fi

# Upgrade any tooling
upgrade:
	just --justfile rs/justfile upgrade
	just --justfile js/justfile upgrade

# Build the packages
build:
	just --justfile rs/justfile build
	just --justfile js/justfile build
