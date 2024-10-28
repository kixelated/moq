use moq_transfork::Path;
use serde::{Deserialize, Serialize};

use super::{Audio, Error, Result, Video};

#[serde_with::serde_as]
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
pub struct Broadcast {
	#[serde(default, skip_serializing_if = "Vec::is_empty")]
	pub video: Vec<Video>,

	#[serde(default, skip_serializing_if = "Vec::is_empty")]
	pub audio: Vec<Audio>,
}

impl Broadcast {
	#[allow(clippy::should_implement_trait)]
	pub fn from_str(s: &str) -> Result<Self> {
		Ok(serde_json::from_str(s)?)
	}

	pub fn from_slice(v: &[u8]) -> Result<Self> {
		Ok(serde_json::from_slice(v)?)
	}

	pub fn from_reader(reader: impl std::io::Read) -> Result<Self> {
		Ok(serde_json::from_reader(reader)?)
	}

	pub fn to_string(&self) -> Result<String> {
		Ok(serde_json::to_string(self)?)
	}

	pub fn to_string_pretty(&self) -> Result<String> {
		Ok(serde_json::to_string_pretty(self)?)
	}

	pub fn to_vec(&self) -> Result<Vec<u8>> {
		Ok(serde_json::to_vec(self)?)
	}

	pub fn to_writer(&self, writer: impl std::io::Write) -> Result<()> {
		Ok(serde_json::to_writer(writer, self)?)
	}

	pub async fn fetch(session: &mut moq_transfork::Session, path: Path) -> Result<Self> {
		let track = moq_transfork::Track {
			path,
			priority: -1,
			group_order: moq_transfork::GroupOrder::Desc,
			group_expires: std::time::Duration::ZERO,
		};

		let mut track = session.subscribe(track);
		let mut group = track.next_group().await?.ok_or(Error::Empty)?;
		let frame = group.read_frame().await?.ok_or(Error::Empty)?;
		let parsed = Self::from_slice(&frame)?;

		Ok(parsed)
	}

	/// Returns the track metadata that should be used for this catalog.
	pub fn track(path: Path) -> moq_transfork::Track {
		moq_transfork::Track {
			path: path.push("catalog.json"),
			priority: -1,
			group_order: moq_transfork::GroupOrder::Desc,
			group_expires: std::time::Duration::ZERO,
		}
	}

	pub fn is_empty(&self) -> bool {
		self.video.is_empty() && self.audio.is_empty()
	}
}

#[cfg(test)]
mod test {
	use super::*;
	use crate::catalog;

	#[test]
	fn simple() {
		let mut encoded = r#"{
			"video": [
				{
					"track": {
						"name": "video",
						"priority": 2
					},
					"codec": "avc1.64001f",
					"resolution": {
						"width": 1280,
						"height": 720
					},
					"bitrate": 6000000
				}
			],
			"audio": [
				{
					"track": {
						"name": "audio",
						"priority": 1
					},
					"codec": "opus",
					"sample_rate": 48000,
					"channel_count": 2,
					"bitrate": 128000
				}
			]
		}"#
		.to_string();

		encoded.retain(|c| !c.is_whitespace());

		let decoded = Broadcast {
			video: vec![Video {
				track: catalog::Track {
					name: "video".to_string(),
					priority: 2,
				},
				codec: catalog::H264 {
					profile: 0x64,
					constraints: 0x00,
					level: 0x1f,
				}
				.into(),
				description: Default::default(),
				resolution: catalog::Dimensions {
					width: 1280,
					height: 720,
				},
				layers: Default::default(),
				bitrate: Some(6_000_000),
			}],
			audio: vec![Audio {
				track: catalog::Track {
					name: "audio".to_string(),
					priority: 1,
				},
				codec: catalog::AudioCodec::Opus,
				sample_rate: 48_000,
				channel_count: 2,
				bitrate: Some(128_000),
			}],
		};

		let output = Broadcast::from_str(&encoded).expect("failed to decode");
		assert_eq!(decoded, output, "wrong decoded output");

		let output = decoded.to_string().expect("failed to encode");
		assert_eq!(encoded, output, "wrong encoded output");
	}
}
