#!/usr/bin/env just --justfile

# Using Just: https://github.com/casey/just?tab=readme-ov-file#installation

export RUST_BACKTRACE := "1"
export RUST_LOG := "info"

# List all of the available commands.
default:
  just --list

# Run the relay, web server, and publish bbb.
all:
	npm i && npx concurrently --kill-others --names srv,bbb,web --prefix-colors auto "just relay" "sleep 1 && just bbb" "sleep 2 && just web"

# Run a localhost relay server
relay:
	cargo run --bin moq-relay -- --bind "[::]:4443" --tls-self-sign "localhost:4443" --cluster-node "localhost:4443" --tls-disable-verify --dev

# Run a localhost leaf server, connecting to the relay server
leaf:
	cargo run --bin moq-relay -- --bind "[::]:4444" --tls-self-sign "localhost:4444" --cluster-node "localhost:4444" --cluster-root "localhost:4443" --tls-disable-verify --dev

# Run a cluster of relay servers
cluster:
	npm i && npx concurrently --kill-others --names root,leaf,bbb,web --prefix-colors auto "just relay" "sleep 1 && just leaf" "sleep 2 && just bbb" "sleep 3 && just web"

# Download and stream the Big Buck Bunny video
bbb: (download "bbb" "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4") (pub "bbb")

# Download and stream the inferior Tears of Steel video
tos: (download "tos" "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4") (pub "tos")

# Download the video and convert it to a fragmented MP4 that we can stream
download name url:
	if [ ! -f dev/{{name}}.mp4 ]; then \
		wget {{url}} -O dev/{{name}}.mp4; \
	fi

	if [ ! -f dev/{{name}}.fmp4 ]; then \
		ffmpeg -i dev/{{name}}.mp4 \
			-c copy \
			-f mp4 -movflags cmaf+separate_moof+delay_moov+skip_trailer+frag_every_frame \
			dev/{{name}}.fmp4; \
	fi

# Publish a video using ffmpeg to the localhost relay server
pub name:
	# Pre-build the binary so we don't queue media while compiling.
	cargo build --bin moq-karp

	# Run ffmpeg and pipe the output to moq-karp
	ffmpeg -hide_banner -v quiet \
		-stream_loop -1 -re \
		-i "dev/{{name}}.fmp4" \
		-c copy \
		-f mp4 -movflags cmaf+separate_moof+delay_moov+skip_trailer+frag_every_frame \
		- | cargo run --bin moq-karp -- publish "http://localhost:4443/demo/{{name}}"

# Publish a video using gstreamer to the localhost relay server
gst name:
	# Build the gstreamer plugin
	cargo build -p moq-gst
	export GST_PLUGIN_PATH="${PWD}/target/debug${GST_PLUGIN_PATH:+:$GST_PLUGIN_PATH}"

	# Run gstreamer and pipe the output to moq-karp
	gst-launch-1.0 -v -e multifilesrc location="dev/{{name}}.fmp4" loop=true ! qtdemux name=demux \
		demux.video_0 ! h264parse ! queue ! identity sync=true ! isofmp4mux name=mux chunk-duration=1 fragment-duration=1 ! moqsink url="http://localhost:4443" room="demo" broadcast="{{name}}" \
		demux.audio_0 ! aacparse ! queue ! mux.


# Run the web server
web:
	npm i && npm run dev

# Publish the clock broadcast
clock-pub:
	cargo run --bin moq-clock -- "http://localhost:4443" publish

# Subscribe to the clock broadcast
clock-sub:
	cargo run --bin moq-clock -- "http://localhost:4443" subscribe

# Run the CI checks
check:
	cargo check --all
	cargo test --all
	cargo clippy --all -- -D warnings
	cargo fmt --all -- --check
	cargo machete
	npm i && npm run check

# Automatically fix some issues.
fix:
	cargo clippy --all --fix --allow-dirty --allow-staged --all-targets --all-features
	cargo fmt --all
	npm i && npm run fix

# Build the binaries
build: pack
	cargo build

# Build release NPM package
pack:
	npm i && npm run build

# Build and link the NPM package
# TODO support more than just bun
link: pack
	bun link
