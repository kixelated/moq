//! This module contains the structs and functions for the MoQ catalog format

/// The catalog format is a JSON file that describes the tracks available in a broadcast.
use serde::{Deserialize, Serialize};

use crate::catalog::{Audio, Video};
use crate::model::{CatalogConsumer, CatalogProducer};
use crate::Result;
use moq_lite::Produce;

use super::Location;

/// A catalog track, created by a broadcaster to describe the tracks available in a broadcast.
#[serde_with::serde_as]
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Root {
	/// A list of video tracks for the same content.
	///
	/// The viewer is expected to choose one of them based on their preferences, such as:
	/// - resolution
	/// - bitrate
	/// - codec
	/// - etc
	#[serde(default, skip_serializing_if = "Vec::is_empty")]
	pub video: Vec<Video>,

	/// A list of audio tracks for the same content.
	///
	/// The viewer is expected to choose one of them based on their preferences, such as:
	/// - codec
	/// - bitrate
	/// - language
	/// - etc
	#[serde(default, skip_serializing_if = "Vec::is_empty")]
	pub audio: Vec<Audio>,

	/// A location track, used to indicate the desired position of the broadcaster from -1 to 1.
	/// This is primarily used for audio panning but can also be used for video.
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub location: Option<Location>,
}

impl Root {
	/// The default name for the catalog track.
	pub const DEFAULT_NAME: &str = "catalog.json";

	/// Parse a catalog from a string.
	#[allow(clippy::should_implement_trait)]
	pub fn from_str(s: &str) -> Result<Self> {
		Ok(serde_json::from_str(s)?)
	}

	/// Parse a catalog from a slice of bytes.
	pub fn from_slice(v: &[u8]) -> Result<Self> {
		Ok(serde_json::from_slice(v)?)
	}

	/// Parse a catalog from a reader.
	pub fn from_reader(reader: impl std::io::Read) -> Result<Self> {
		Ok(serde_json::from_reader(reader)?)
	}

	/// Serialize the catalog to a string.
	pub fn to_string(&self) -> Result<String> {
		Ok(serde_json::to_string(self)?)
	}

	/// Serialize the catalog to a pretty string.
	pub fn to_string_pretty(&self) -> Result<String> {
		Ok(serde_json::to_string_pretty(self)?)
	}

	/// Serialize the catalog to a vector of bytes.
	pub fn to_vec(&self) -> Result<Vec<u8>> {
		Ok(serde_json::to_vec(self)?)
	}

	/// Serialize the catalog to a writer.
	pub fn to_writer(&self, writer: impl std::io::Write) -> Result<()> {
		Ok(serde_json::to_writer(writer, self)?)
	}

	/// Produce a catalog track that describes the available media tracks.
	pub fn produce(self) -> Produce<CatalogProducer, CatalogConsumer> {
		let track = Root::default_track().produce();

		Produce {
			producer: CatalogProducer::new(track.producer, self),
			consumer: track.consumer.into(),
		}
	}

	pub fn default_track() -> moq_lite::Track {
		moq_lite::Track {
			name: Root::DEFAULT_NAME.to_string(),
			priority: 100,
		}
	}
}

#[cfg(test)]
mod test {
	use crate::catalog::{AudioCodec::Opus, AudioConfig, VideoConfig, VideoConfigOptional, H264};
	use moq_lite::Track;

	use super::*;

	#[test]
	fn simple() {
		let mut encoded = r#"{
			"video": [
				{
					"track": {
						"name": "video",
						"priority": 1
					},
					"config": {
						"codec": "avc1.64001f",
						"codedWidth": 1280,
						"codedHeight": 720,
						"bitrate": 6000000,
						"framerate": 30.0
					}
				}
			],
			"audio": [
				{
					"track": {
						"name": "audio",
						"priority": 2
					},
					"config": {
						"codec": "opus",
						"sampleRate": 48000,
						"numberOfChannels": 2,
						"bitrate": 128000
					}
				}
			]
		}"#
		.to_string();

		encoded.retain(|c| !c.is_whitespace());

		let decoded = Root {
			video: vec![Video {
				track: Track {
					name: "video".to_string(),
					priority: 1,
				},
				config: VideoConfig {
					codec: H264 {
						profile: 0x64,
						constraints: 0x00,
						level: 0x1f,
					}
					.into(),
					optional: VideoConfigOptional {
						coded_width: Some(1280),
						coded_height: Some(720),
						bitrate: Some(6_000_000),
						framerate: Some(30.0),
						..Default::default()
					},
				},
			}],
			audio: vec![Audio {
				track: Track {
					name: "audio".to_string(),
					priority: 2,
				},
				config: AudioConfig {
					codec: Opus,
					sample_rate: 48_000,
					channel_count: 2,
					bitrate: Some(128_000),
					description: None,
				},
			}],
			..Default::default()
		};

		let output = Root::from_str(&encoded).expect("failed to decode");
		assert_eq!(decoded, output, "wrong decoded output");

		let output = decoded.to_string().expect("failed to encode");
		assert_eq!(encoded, output, "wrong encoded output");
	}
}
