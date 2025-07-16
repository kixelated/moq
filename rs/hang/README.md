[![Documentation](https://docs.rs/hang/badge.svg)](https://docs.rs/hang/)
[![Crates.io](https://img.shields.io/crates/v/hang.svg)](https://crates.io/crates/hang)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../../LICENSE-MIT)

# hang

A media library built on top of `moq-lite` for streaming audio and video.
`hang` provides media-specific functionality, split into a few components:

- **Broadcast**: A discoverable collection of tracks, documented using a catalog.
- **Catalog**: Metadata describing the available tracks, codec information, etc. This is a live track itself and is updated as tracks are added/removed/changed.
- **Track**: Audio/video streams, as well as other types of data.
- **Group**: A group of pictures (video) or collection of samples (audio). Each group is independently decodable.
- **Frame**: A timestamp and a codec payload pair.

## Supported Codecs
We most of the implement the [WebCodecs specification](https://www.w3.org/TR/webcodecs/#video-decoder-config).

- **Video:** H.264, H.265, VP8, VP9, AV1
- **Audio:** AAC, Opus

## CMAF Import
There's also a `cmaf` module that can import fMP4/CMAF files into a hang broadcast.
It's crude and doesn't support all features, but it's a good starting point to ingest existing content.

## Example

```rust
use hang::{BroadcastProducer, Frame};

let mut broadcast = BroadcastProducer::new();

// Create a video track
let video = hang::catalog::Video {
    track: moq_lite::Track { name: "video".to_string(), priority: 1 },
	// Decoder configuration.
    config: Default::default(),
};
let mut track = broadcast.create_video(video);

// NOTE: Unlike moq_lite, you don't create a group producer.
// One will be created automatically when you write a keyframe.

let frame = Frame {
    timestamp: std::time::Duration::from_secs(1),
    keyframe: true,
    payload: b"video data".as_slice().into(),
};
track.write(frame);
```
