use crate as hang;
use anyhow::Context;
use bytes::Buf;
use moq_lite as moq;

/// AAC decoder, initialized via AudioSpecificConfig (2 bytes from ESDS box).
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
		// 5 bits: audioObjectType
		// 4 bits: samplingFrequencyIndex
		// 4 bits: channelConfiguration
		// 3 bits: flags (ignored)
		let b0 = buf.get_u8();
		let b1 = buf.get_u8();

		let object_type = b0 >> 3;
		anyhow::ensure!(object_type < 31, "extended audioObjectType not supported");

		let freq_index = ((b0 & 0x07) << 1) | (b1 >> 7);
		let channel_config = (b1 >> 3) & 0x0F;

		const SAMPLE_RATES: [u32; 13] = [
			96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
		];

		let sample_rate = *SAMPLE_RATES
			.get(freq_index as usize)
			.context("unsupported sample rate index")?;

		anyhow::ensure!(channel_config > 0 && channel_config <= 7, "unsupported channel config");

		let track = moq::Track {
			name: self.broadcast.track_name("audio"),
			priority: 2,
		};

		let config = hang::catalog::AudioConfig {
			codec: hang::catalog::AAC { profile: object_type }.into(),
			sample_rate,
			channel_count: channel_config as u32,
			bitrate: None,
			description: None,
		};

		tracing::debug!(name = ?track.name, ?config, "starting track");

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
