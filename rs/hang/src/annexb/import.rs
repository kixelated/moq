use super::Result;
use crate::catalog::{Video, VideoConfig, H264};
use crate::model::{Frame, Timestamp, TrackProducer};
use crate::{Catalog, CatalogProducer};
use bytes::{Bytes, BytesMut};
use h264_parser::AnnexBParser;
use moq_lite::{BroadcastProducer, Track};
use std::borrow::Cow;
use tokio::io::AsyncReadExt;

pub struct Import {
	broadcast: BroadcastProducer,

	// The catalog being produced
	catalog: CatalogProducer,
}

impl Import {
	/// Create a new Annex-B importer that will write to the given broadcast.
	pub fn new(mut broadcast: BroadcastProducer) -> Self {
		let catalog = Catalog::default().produce();
		broadcast.insert_track(catalog.consumer.track);

		Self {
			broadcast,
			catalog: catalog.producer,
		}
	}

	pub async fn read_from<T: AsyncReadExt + Unpin>(&mut self, input: &mut T) -> Result<()> {
		let mut parser = AnnexBParser::new();
		let mut buffer = BytesMut::new();

		let mut tp: Option<TrackProducer> = None;

		let now = std::time::Instant::now();

		while input.read_buf(&mut buffer).await? > 0 {
			parser.push(&buffer);
			buffer.clear();
			while let Some(au) = parser.next_access_unit()? {
				match tp {
					Some(ref mut track) => {
						let ts = now.elapsed().as_micros();
						let payload = match au.to_annexb_webcodec_bytes() {
							Cow::Borrowed(b) => Bytes::copy_from_slice(b),
							Cow::Owned(b) => Bytes::copy_from_slice(&b),
						};
						let frame = Frame {
							timestamp: Timestamp::from_micros(ts as u64),
							keyframe: au.is_keyframe(),
							payload,
						};

						track.write(frame);
					}
					None => {
						if let Some(ref sps) = au.sps {
							let constraint_flags: u8 = ((sps.constraint_set0_flag as u8) << 7)
								| ((sps.constraint_set1_flag as u8) << 6)
								| ((sps.constraint_set2_flag as u8) << 5)
								| ((sps.constraint_set3_flag as u8) << 4)
								| ((sps.constraint_set4_flag as u8) << 3)
								| ((sps.constraint_set5_flag as u8) << 2);

							let track_name = String::from("video0");
							let track = Track {
								name: track_name.clone(),
								priority: 2,
							};
							let track_produce = track.produce();
							self.broadcast.insert_track(track_produce.consumer);

							let config = VideoConfig {
								coded_width: Some(sps.width),
								coded_height: Some(sps.height),
								codec: H264 {
									profile: sps.profile_idc,
									constraints: constraint_flags,
									level: sps.level_idc,
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

							let mut renditions = std::collections::HashMap::new();
							renditions.insert(track_name, config);

							let video = Video {
								renditions,
								priority: 2,
								display: None,
								rotation: None,
								flip: None,
								detection: None,
							};

							self.catalog.set_video(Some(video));
							tp = Some(track_produce.producer.into());
							self.catalog.publish();
						}
					}
				}
			}
		}
		Ok(())
	}
}
