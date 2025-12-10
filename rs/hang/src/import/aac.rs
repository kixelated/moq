use crate as hang;
use anyhow::Context;
use bytes::Buf;
use moq_lite as moq;

/// AAC decoder, initialized via AudioSpecificConfig (variable length from ESDS box).
pub struct Aac {
	broadcast: hang::BroadcastProducer,
	track: Option<hang::TrackProducer>,
}

impl Aac {
	pub fn new(broadcast: hang::BroadcastProducer) -> Self {
		Self { broadcast, track: None }
	}

	pub fn initialize<T: Buf>(&mut self, buf: &mut T) -> anyhow::Result<()> {
		anyhow::ensure!(buf.remaining() >= 2, "AudioSpecificConfig must be at least 2 bytes");

		// Parse AudioSpecificConfig (ISO 14496-3)
		// This parser handles variable-length configurations including:
		// - Basic formats (object_type < 31)
		// - Extended formats (object_type == 31)
		// - SBR/PS extensions
		// - Explicit sample rates (freq_index == 15)

		const SAMPLE_RATES: [u32; 13] = [
			96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
		];

		// Read first byte
		let b0 = buf.get_u8();
		let mut object_type = (b0 >> 3) as u8;
		let mut freq_index;

		// Handle extended audioObjectType (object_type == 31)
		if object_type == 31 {
			anyhow::ensure!(buf.remaining() >= 2, "extended audioObjectType requires 2 additional bytes");
			// Extended format: next 6 bits are the extended object_type (32-63)
			// Bits 5-7 of b0 are the first 3 bits of extended object_type
			let b_ext = buf.get_u8();
			// Bits 0-2 of b_ext are the last 3 bits of extended object_type
			let audio_object_type_ext = (((b0 & 0x07) << 3) | ((b_ext >> 5) & 0x07)) as u8;
			object_type = 32 + audio_object_type_ext;
			// Bits 3-6 of b_ext are samplingFrequencyIndex (4 bits)
			freq_index = ((b_ext >> 1) & 0x0F) as u8;
			// Bit 0 of b_ext is the first bit of channelConfiguration
			let channel_config_high = (b_ext & 0x01) as u8;
			
			// Read next byte for rest of channelConfiguration
			anyhow::ensure!(buf.remaining() >= 1, "AudioSpecificConfig incomplete");
			let b1 = buf.get_u8();
			// Bits 5-7 of b1 are the remaining 3 bits of channelConfiguration
			let channel_config = ((channel_config_high << 3) | ((b1 >> 5) & 0x07)) as u8;
			
			// Handle explicit sample rate (freq_index == 15)
			let sample_rate = if freq_index == 15 {
				anyhow::ensure!(buf.remaining() >= 3, "explicit sample rate requires 3 additional bytes");
				let rate_bytes = [buf.get_u8(), buf.get_u8(), buf.get_u8()];
				((rate_bytes[0] as u32) << 16) | ((rate_bytes[1] as u32) << 8) | (rate_bytes[2] as u32)
			} else {
				*SAMPLE_RATES
					.get(freq_index as usize)
					.context("unsupported sample rate index")?
			};

			// Consume any remaining extension data
			if buf.remaining() > 0 {
				buf.advance(buf.remaining());
			}

			let profile = object_type;
			let channel_count = if channel_config == 0 {
				2
			} else if channel_config <= 7 {
				channel_config as u32
			} else {
				tracing::warn!(channel_config, "unsupported channel config, defaulting to stereo");
				2
			};

			let track = moq::Track {
				name: self.broadcast.track_name("audio"),
				priority: 2,
			};

			let config = hang::catalog::AudioConfig {
				codec: hang::catalog::AAC { profile }.into(),
				sample_rate,
				channel_count,
				bitrate: None,
				description: None,
			};

			tracing::debug!(name = ?track.name, ?config, object_type, profile, "starting track");

			let track = track.produce();
			self.broadcast.insert_track(track.consumer);

			let mut catalog = self.broadcast.catalog.lock();
			let audio = catalog.insert_audio(track.producer.info.name.clone(), config);
			audio.priority = 2;

			self.track = Some(track.producer.into());

			return Ok(());
		}

		// Standard format: bits 5-7 of b0 are first 3 bits of freq_index
		freq_index = ((b0 & 0x07) << 1) as u8;

		// Read second byte
		anyhow::ensure!(buf.remaining() >= 1, "AudioSpecificConfig incomplete");
		let b1 = buf.get_u8();

		// Complete frequency index (bit 7 of b1 is bit 0 of freq_index)
		freq_index |= (b1 >> 7) & 0x01;

		// Handle explicit sample rate (freq_index == 15)
		let sample_rate = if freq_index == 15 {
			anyhow::ensure!(buf.remaining() >= 3, "explicit sample rate requires 3 additional bytes");
			// Read 24-bit sample rate
			let rate_bytes = [buf.get_u8(), buf.get_u8(), buf.get_u8()];
			((rate_bytes[0] as u32) << 16) | ((rate_bytes[1] as u32) << 8) | (rate_bytes[2] as u32)
		} else {
			*SAMPLE_RATES
				.get(freq_index as usize)
				.context("unsupported sample rate index")?
		};

		// Channel configuration
		let channel_config = (b1 >> 3) & 0x0F;

		// Consume any remaining extension data (SBR, PS, etc.)
		// AudioSpecificConfig can have variable-length extensions that we don't need to parse.
		// Since we've already extracted the essential info (object_type, sample_rate, channels),
		// we'll consume any remaining bytes to ensure the buffer is properly advanced.
		// This makes the parser robust to different AAC variants from OBS and other sources.
		if buf.remaining() > 0 {
			buf.advance(buf.remaining());
		}

		// Use object_type as profile
		// Common profiles:
		// 2 = AAC-LC
		// 5 = HE-AAC (AAC+)
		// 29 = HE-AACv2 (AAC++)
		// Other values are also valid and should be preserved
		let profile = object_type;

		// Be more lenient with channel configuration
		// Some formats may use channel_config == 0 (implicit) or > 7
		let channel_count = if channel_config == 0 {
			// Implicit channel configuration, default to stereo
			2
		} else if channel_config <= 7 {
			channel_config as u32
		} else {
			// Extended channel configurations, default to stereo
			tracing::warn!(channel_config, "unsupported channel config, defaulting to stereo");
			2
		};

		let track = moq::Track {
			name: self.broadcast.track_name("audio"),
			priority: 2,
		};

		let config = hang::catalog::AudioConfig {
			codec: hang::catalog::AAC { profile }.into(),
			sample_rate,
			channel_count,
			bitrate: None,
			description: None,
		};

		tracing::debug!(name = ?track.name, ?config, object_type, profile, "starting track");

		let track = track.produce();
		self.broadcast.insert_track(track.consumer);

		let mut catalog = self.broadcast.catalog.lock();
		let audio = catalog.insert_audio(track.producer.info.name.clone(), config);
		audio.priority = 2;

		self.track = Some(track.producer.into());

		Ok(())
	}

	pub fn decode<T: Buf>(&mut self, buf: &mut T, pts: hang::Timestamp) -> anyhow::Result<()> {
		let track = self.track.as_mut().context("not initialized")?;

		let frame = hang::Frame {
			timestamp: pts,
			keyframe: true,
			payload: buf.copy_to_bytes(buf.remaining()),
		};

		track.write(frame)?;

		Ok(())
	}

	pub fn is_initialized(&self) -> bool {
		self.track.is_some()
	}
}

impl Drop for Aac {
	fn drop(&mut self) {
		if let Some(track) = self.track.take() {
			tracing::debug!(name = ?track.info.name, "ending track");
			self.broadcast.catalog.lock().remove_audio(&track.info.name);
		}
	}
}
