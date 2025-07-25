mod aac;
mod codec;

pub use aac::*;
pub use codec::*;

use bytes::Bytes;

use serde::{Deserialize, Serialize};
use serde_with::{hex::Hex, DisplayFromStr};

/// Information about an audio track in the catalog.
///
/// This struct combines MoQ track information with audio-specific configuration
/// including codec details, sample rate, and channel information.
#[serde_with::serde_as]
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Audio {
	// Generic information about the track
	pub track: moq_lite::Track,

	// The configuration of the audio track
	pub config: AudioConfig,
}

/// Audio decoder configuration based on WebCodecs AudioDecoderConfig.
///
/// This struct contains all the information needed to initialize an audio decoder,
/// including codec-specific parameters, sample rate, and channel configuration.
///
/// Reference: <https://www.w3.org/TR/webcodecs/#audio-decoder-config>
#[serde_with::serde_as]
#[serde_with::skip_serializing_none]
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioConfig {
	// The codec, see the registry for details:
	// https://w3c.github.io/webcodecs/codec_registry.html
	#[serde_as(as = "DisplayFromStr")]
	pub codec: AudioCodec,

	// The sample rate of the audio in Hz
	pub sample_rate: u32,

	// The number of channels in the audio
	#[serde(rename = "numberOfChannels")]
	pub channel_count: u32,

	// The bitrate of the audio track in bits per second
	#[serde(default)]
	pub bitrate: Option<u64>,

	// Some codecs include a description so the decoder can be initialized without extra data.
	// If not provided, there may be in-band metadata (marginally higher overhead).
	#[serde(default)]
	#[serde_as(as = "Option<Hex>")]
	pub description: Option<Bytes>,
}
