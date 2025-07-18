[![Documentation](https://docs.rs/moq-lite/badge.svg)](https://docs.rs/moq-lite/)
[![Crates.io](https://img.shields.io/crates/v/moq-lite.svg)](https://crates.io/crates/moq-lite)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE-MIT)

# moq-lite

A Rust implementation of the [Media over QUIC](https://quic.video) transport.

This crate provides the core networking layer, implementing the [moq-lite specification](https://datatracker.ietf.org/doc/draft-lcurley-moq-lite/).
Live media is built on top of this layer using something like [hang](../hang).

- **Broadcasts**: Discoverable collections of tracks.
- **Tracks**: Named streams of data, split into groups.
- **Groups**: A sequential collection of frames, usually starting with a keyframe.
- **Frame**: A timed chunk of data.

## Example - Chat track
```rust
	// Optional: Use moq_native to make a QUIC client.
    let config = moq_native::ClientConfig::default(); // See documentation
	let client = moq_native::Client::new(config);

	// For local development, use: http://localhost:4443/
	let url = url::Url::parse("https://relay.quic.video/anon").unwrap();

	// Establish a WebTransport/QUIC connection.
	let connection = client.connect(url).await?;

	// Perform the MoQ handshake.
	let mut session = moq_lite::Session::connect(connection).await?;

	// Create a broadcast.
	// A broadcast is a collection of tracks, but in this example there's just one.
	let broadcast = moq_lite::BroadcastProducer::new();

	// Create a track that we'll insert into the broadcast.
	// A track is a series of groups representing a live stream.
	let track = broadcast.create(moq_lite::Track {
		name: "chat".to_string(),
		priority: 0,
	});

	// Create a group.
	// Each group is independent and the newest group(s) will be prioritized.
	let group = track.append_group();

	// Write frames to the group.
	// Each frame is dependent on the previous frame, so older frames are prioritized.
	group.append_frame(b"Hello");
	group.append_frame(b"World");

	// Finally, publish the broadcast to the session.
	// You can provide a broadcast path which gets appended to the URL.
	// Feel free to publish broadcasts starting with `anon/` to bypass authentication.
	session.publish("anon/my-broadcast", broadcast.consume());

	// NOTE: You can create multiple consumer instances of any `XxxProducer`
	// Each which will receive a (ref-counted) copy of the data.
	let _broadcast = broadcast.consume();
	let _track = track.consume();
	let _group = group.consume();
```
