use moq_lite;
use tokio::runtime::Runtime;
use url::Url;

use moq_native::client::*;

use crate::model::{Frame, Timestamp, TrackProducer};
use crate::{Catalog, CatalogProducer};
use bytes::{Bytes, BytesMut};
use crate::catalog::{Video, VideoConfig, H264};
use moq_lite::{BroadcastProducer, OriginConsumer, OriginProducer, Produce, Track};
use std::{collections::HashMap, time::Duration};
use std::ffi::c_void;
use std::thread;
use std::thread::JoinHandle;
use std::sync::atomic::{AtomicBool, Ordering};

static mut IMPORT: Option<ImportJoy> = None;
static mut HANDLE: Option<JoinHandle<()>> = None;
static RUNNING: AtomicBool = AtomicBool::new(false);

#[no_mangle]
pub extern "C" fn hang_start_from_c() {
    let rt = Runtime::new().unwrap();

    let url = Url::parse("http://localhost:4443/anon").expect("joy");
    
    let name = String::from("bbb");
 
    RUNNING.store(true, Ordering::Relaxed);

    unsafe
    {
        HANDLE = Some(std::thread::spawn(move || {
            let rt = Runtime::new().unwrap();

            rt.block_on(async {
                let _ = client(url, name).await;
            });
        }));
    }
}

#[no_mangle]
pub extern "C" fn hang_stop_from_c() {
    RUNNING.store(false, Ordering::Relaxed);
}

#[no_mangle]
pub extern "C" fn hang_write_video_packet_from_c(data: *const u8, size: usize, keyframe: i32, dts: u64) {
    unsafe
    {
        if let Some(ref mut import) = IMPORT {
            let mut _keyframe = false;

            if (keyframe > 0) {
                _keyframe = true;
            }

            import.write_video_frame(data, size, _keyframe, dts);
        }
    }
}

pub async fn client(
	url: Url,
	name: String,
) -> anyhow::Result<()> {
	let broadcast = moq_lite::Broadcast::produce();
	let config = moq_native::ClientConfig::default();
	let client = config.init()?;

    let connection = client.connect(url).await?;

    let origin = moq_lite::Origin::produce();

    let session = moq_lite::Session::connect(connection, origin.consumer, None).await?;

    unsafe
    {
        IMPORT = Some(ImportJoy::new(broadcast.producer));
        if let Some(ref mut import) = IMPORT {
            import.init();
        }
    }

    origin.producer.publish_broadcast(&name, broadcast.consumer);

    while (RUNNING.load(Ordering::Relaxed))
    {
        thread::sleep(Duration::from_millis(30));
    }

    session.close(moq_lite::Error::Cancel);

    Ok(())
}

pub struct ImportJoy {
	// Any partial data in the input buffer
	buffer: BytesMut,

	// The broadcast being produced
	broadcast: BroadcastProducer,

	// The catalog being produced
	catalog: CatalogProducer,

	// A lookup to tracks in the broadcast
	tracks: HashMap<u32, TrackProducer>,

    sent_one_keyframe: bool,
}

impl ImportJoy {
	/// Create a new importer that will write to the given broadcast.
	pub fn new(mut broadcast: BroadcastProducer) -> Self {
		let catalog = Catalog::default().produce();
		broadcast.insert_track(catalog.consumer.track);

		Self {
			buffer: BytesMut::new(),
			broadcast,
			catalog: catalog.producer,
			tracks: HashMap::default(),
            sent_one_keyframe: false
		}
	}

	pub fn init(&mut self) -> () {
		// Produce the catalog
		let mut video_renditions = HashMap::new();
		// let mut audio_renditions = HashMap::new();

        let (track_name, config) = Self::init_video();
        let _track = Track {
            name: track_name.clone(),
            priority: 2,
        };
        let track_produce = _track.produce();
        self.broadcast.insert_track(track_produce.consumer);
        video_renditions.insert(track_name, config);
        let track = track_produce.producer;

        self.tracks.insert(0, track.into());

		if !video_renditions.is_empty() {
			let video = Video {
				renditions: video_renditions,
				priority: 2,
				display: None,
				rotation: None,
				flip: None,
			};
			self.catalog.set_video(Some(video));
		}

        /*
		if !audio_renditions.is_empty() {
			let audio = Audio {
				renditions: audio_renditions,
				priority: 2,
			};
			self.catalog.set_audio(Some(audio));
		}
        */

		self.catalog.publish();

		()
	}

	pub fn init_video() -> (String, VideoConfig) {
		let name = String::from("video1");

		let config = VideoConfig {
            coded_width: Some(1280),
            coded_height: Some(720),
            codec: H264 {
                profile: 0x4d,
                constraints: 0x00,
                level: 0x29,
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

		(name, config)
	}

	pub fn write_video_frame(&mut self, data: *const u8, size: usize, keyframe: bool, dts: u64) -> () {
        if (!self.sent_one_keyframe) {
            if (!keyframe) {
                return;
            } else {
                self.sent_one_keyframe = true;
            }
        }

        let zero = 0;
        let _track = self.tracks.get_mut(&zero);

        let bytes: &[u8] = unsafe {
            std::slice::from_raw_parts(data, size)
        };
		let payload = Bytes::from(bytes);

        let timestamp = Timestamp::from_micros(dts);

        // println!("Hello, world: joy {} size {} keyframe {}", dts, size, keyframe);

        if let Some(track) = _track {
            let frame = Frame {
                timestamp,
                keyframe,
                payload,
            };

            track.write(frame);
        }
    }
}
