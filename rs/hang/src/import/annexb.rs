use crate as hang;
use bytes::{Buf, Bytes};
use h264_parser::AnnexBParser;
use moq_lite as moq;
use std::{borrow::Cow, sync::Arc};

// TODO Also support H265
pub struct AnnexB {
	// The broadcast being produced.
	// This `hang` variant includes a catalog.
	broadcast: hang::BroadcastProducer,

	// The track being produced.
	track: Option<hang::TrackProducer>,

	// The parser for the AnnexB format.
	parser: AnnexBParser,
}

impl AnnexB {
	pub fn new(broadcast: hang::BroadcastProducer) -> Self {
		Self {
			broadcast,
			parser: AnnexBParser::new(),
			track: None,
		}
	}

	fn init(&mut self, sps: &Arc<h264_parser::Sps>) -> anyhow::Result<()> {
		let constraint_flags: u8 = ((sps.constraint_set0_flag as u8) << 7)
			| ((sps.constraint_set1_flag as u8) << 6)
			| ((sps.constraint_set2_flag as u8) << 5)
			| ((sps.constraint_set3_flag as u8) << 4)
			| ((sps.constraint_set4_flag as u8) << 3)
			| ((sps.constraint_set5_flag as u8) << 2);

		let track = moq::Track {
			name: self.broadcast.track_name("video"),
			priority: 2,
		};

		let config = hang::catalog::VideoConfig {
			coded_width: Some(sps.width),
			coded_height: Some(sps.height),
			codec: hang::catalog::H264 {
				profile: sps.profile_idc,
				constraints: constraint_flags,
				level: sps.level_idc,
				inline: true,
			}
			.into(),
			description: None,
			// TODO: populate these fields
			framerate: None,
			bitrate: None,
			display_ratio_width: None,
			display_ratio_height: None,
			optimize_for_latency: None,
		};

		tracing::debug!(name = ?track.name, ?config, "starting track");

		let track = track.produce();
		self.broadcast.insert_track(track.consumer);

		let mut catalog = self.broadcast.catalog.lock();
		let video = catalog.insert_video(track.producer.info.name.clone(), config);
		video.priority = 2;

		self.track = Some(track.producer.into());

		Ok(())
	}

	pub fn decode<T: Buf>(&mut self, buf: &mut T, pts: hang::Timestamp) -> anyhow::Result<()> {
		while buf.has_remaining() {
			let chunk = buf.chunk();
			self.parser.push(chunk);
			buf.advance(chunk.len());

			while let Some(au) = self.parser.next_access_unit()? {
				if let Some(sps) = &au.sps {
					// TODO: Reinitialize the track if the SPS changes.
					// This would be much easier if SPS implemented PartialEq.
					// I tried using Arc::ptr_eq, but each keyframe allocates a new SPS.
					if self.track.is_none() {
						self.init(sps)?;
					}
				}

				let track = match self.track.as_mut() {
					Some(track) => track,
					None => continue,
				};

				let payload = match au.to_annexb_bytes() {
					Cow::Borrowed(b) => Bytes::copy_from_slice(b),
					Cow::Owned(b) => Bytes::from(b), // avoids a copy
				};

				let frame = hang::Frame {
					keyframe: au.is_keyframe(),
					timestamp: pts,
					payload,
				};

				track.write(frame)?;
			}
		}

		Ok(())
	}

	pub fn is_initialized(&self) -> bool {
		self.track.is_some()
	}
}

impl Drop for AnnexB {
	fn drop(&mut self) {
		if let Some(track) = self.track.take() {
			tracing::debug!(name = ?track.info.name, "ending track");
			self.broadcast.catalog.lock().remove_video(&track.info.name);
		}
	}
}
