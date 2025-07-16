//! This module contains the structs and functions for the MoQ catalog format
use std::sync::{Arc, Mutex, MutexGuard};

/// The catalog format is a JSON file that describes the tracks available in a broadcast.
use serde::{Deserialize, Serialize};

use crate::catalog::{Audio, Video};
use crate::Result;

use super::Location;

/// A catalog track, created by a broadcaster to describe the tracks available in a broadcast.
#[serde_with::serde_as]
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Catalog {
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

impl Catalog {
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
	pub fn produce(self) -> CatalogProducer {
		let track = moq_lite::Track {
			name: Catalog::DEFAULT_NAME.to_string(),
			priority: 100,
		}
		.produce();

		CatalogProducer::new(track, self)
	}
}

/// Produces a catalog track that describes the available media tracks.
///
/// The JSON catalog is updated when tracks are added/removed but is *not* automatically published.
/// You'll have to call [`publish`](Self::publish) once all updates are complete.
#[derive(Clone)]
pub struct CatalogProducer {
	/// Access to the underlying track producer.
	pub track: moq_lite::TrackProducer,
	current: Arc<Mutex<Catalog>>,
}

impl CatalogProducer {
	/// Create a new catalog producer with the given track and initial catalog.
	pub fn new(track: moq_lite::TrackProducer, init: Catalog) -> Self {
		Self {
			current: Arc::new(Mutex::new(init)),
			track,
		}
	}

	/// Add a video track to the catalog.
	pub fn add_video(&mut self, video: Video) {
		let mut current = self.current.lock().unwrap();
		current.video.push(video);
	}

	/// Add an audio track to the catalog.
	pub fn add_audio(&mut self, audio: Audio) {
		let mut current = self.current.lock().unwrap();
		current.audio.push(audio);
	}

	/// Set the location information in the catalog.
	pub fn set_location(&mut self, location: Option<Location>) {
		let mut current = self.current.lock().unwrap();
		current.location = location;
	}

	/// Remove a video track from the catalog.
	pub fn remove_video(&mut self, video: &Video) {
		let mut current = self.current.lock().unwrap();
		current.video.retain(|v| v != video);
	}

	/// Remove an audio track from the catalog.
	pub fn remove_audio(&mut self, audio: &Audio) {
		let mut current = self.current.lock().unwrap();
		current.audio.retain(|a| a != audio);
	}

	/// Get mutable access to the catalog for manual updates.
	/// Remember to call [`publish`](Self::publish) after making changes.
	pub fn update(&mut self) -> MutexGuard<'_, Catalog> {
		self.current.lock().unwrap()
	}

	/// Publish the current catalog to all subscribers.
	///
	/// This serializes the catalog to JSON and sends it as a new group on the
	/// catalog track. All changes made since the last publish will be included.
	pub fn publish(&mut self) {
		let current = self.current.lock().unwrap();
		let mut group = self.track.append_group();

		// TODO decide if this should return an error, or be impossible to fail
		let frame = current.to_string().expect("invalid catalog");
		group.write_frame(frame);
		group.finish();
	}

	/// Create a consumer for this catalog, receiving updates as they're [published](Self::publish).
	pub fn consume(&self) -> CatalogConsumer {
		CatalogConsumer::new(self.track.consume())
	}

	/// Finish publishing to this catalog and close the track.
	pub fn finish(self) {
		self.track.finish();
	}
}

impl From<moq_lite::TrackProducer> for CatalogProducer {
	fn from(inner: moq_lite::TrackProducer) -> Self {
		Self::new(inner, Catalog::default())
	}
}

impl Default for CatalogProducer {
	fn default() -> Self {
		let track = moq_lite::Track {
			name: Catalog::DEFAULT_NAME.to_string(),
			priority: 100,
		}
		.produce();

		CatalogProducer::new(track, Catalog::default())
	}
}

/// A catalog consumer, used to receive catalog updates and discover tracks.
///
/// This wraps a `moq_lite::TrackConsumer` and automatically deserializes JSON
/// catalog data to discover available audio and video tracks in a broadcast.
#[derive(Clone)]
pub struct CatalogConsumer {
	/// Access to the underlying track consumer.
	pub track: moq_lite::TrackConsumer,
	group: Option<moq_lite::GroupConsumer>,
}

impl CatalogConsumer {
	/// Create a new catalog consumer from a MoQ track consumer.
	pub fn new(track: moq_lite::TrackConsumer) -> Self {
		Self { track, group: None }
	}

	/// Get the next catalog update.
	///
	/// This method waits for the next catalog publication and returns the
	/// catalog data. If there are no more updates, `None` is returned.
	pub async fn next(&mut self) -> Result<Option<Catalog>> {
		loop {
			tokio::select! {
				res = self.track.next_group() => {
					match res? {
						Some(group) => {
							// Use the new group.
							self.group = Some(group);
						}
						// The track has ended, so we should return None.
						None => return Ok(None),
					}
				},
				Some(frame) = async { self.group.as_mut()?.read_frame().await.transpose() } => {
					self.group.take(); // We don't support deltas yet
					let catalog = Catalog::from_slice(&frame?)?;
					return Ok(Some(catalog));
				}
			}
		}
	}

	/// Wait until the catalog track is closed.
	pub async fn closed(&self) -> Result<()> {
		Ok(self.track.closed().await?)
	}
}

impl From<moq_lite::TrackConsumer> for CatalogConsumer {
	fn from(inner: moq_lite::TrackConsumer) -> Self {
		Self::new(inner)
	}
}

#[cfg(test)]
mod test {
	use crate::catalog::{AudioCodec::Opus, AudioConfig, VideoConfig, H264};
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

		let decoded = Catalog {
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
					description: None,
					coded_width: Some(1280),
					coded_height: Some(720),
					display_ratio_width: None,
					display_ratio_height: None,
					bitrate: Some(6_000_000),
					framerate: Some(30.0),
					optimize_for_latency: None,
					rotation: None,
					flip: None,
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

		let output = Catalog::from_str(&encoded).expect("failed to decode");
		assert_eq!(decoded, output, "wrong decoded output");

		let output = decoded.to_string().expect("failed to encode");
		assert_eq!(encoded, output, "wrong encoded output");
	}
}
