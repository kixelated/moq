use tokio::runtime::Runtime;
use url::Url;

use bytes::Bytes;
use hang::catalog::{Video, VideoConfig, H264};
use hang::model::{Frame, Timestamp, TrackProducer};
use hang::{Catalog, CatalogProducer};
use moq_lite::{BroadcastProducer, Track};
use std::ffi::CStr;
use std::os::raw::c_char;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread::JoinHandle;
use std::{collections::HashMap, time::Duration};

static IMPORT: OnceLock<Mutex<ImportJoy>> = OnceLock::new();
static HANDLE: OnceLock<Mutex<JoinHandle<()>>> = OnceLock::new();
static RUNNING: AtomicBool = AtomicBool::new(false);

/// # Safety
///
/// The caller must ensure that:
/// - `c_server_url` and `c_path` are valid null-terminated C strings
/// - The pointers remain valid for the duration of this function call
#[no_mangle]
pub unsafe extern "C" fn hang_start_from_c(
	c_server_url: *const c_char,
	c_path: *const c_char,
	_c_profile: *const c_char,
) {
	// Validate C string pointers
	if c_server_url.is_null() || c_path.is_null() {
		return;
	}

	let cstr_server_url = CStr::from_ptr(c_server_url);
	let server_url = match cstr_server_url.to_str() {
		Ok(s) => s,
		Err(_) => return,
	};

	let url = match Url::parse(server_url) {
		Ok(u) => u,
		Err(_) => return,
	};

	let cstr_path = CStr::from_ptr(c_path);
	let path = match cstr_path.to_str() {
		Ok(s) => s.to_string(),
		Err(_) => return,
	};

	RUNNING.store(true, Ordering::Relaxed);

	let handle = std::thread::spawn(move || {
		let rt = match Runtime::new() {
			Ok(rt) => rt,
			Err(_) => return,
		};

		rt.block_on(async {
			let _ = client(url, path).await;
		});
	});

	let _ = HANDLE.set(Mutex::new(handle));
}

#[no_mangle]
pub extern "C" fn hang_stop_from_c() {
	RUNNING.store(false, Ordering::Relaxed);
}

/// # Safety
///
/// The caller must ensure that:
/// - `data` points to a valid buffer of at least `size` bytes
/// - The buffer remains valid for the duration of this function call
#[no_mangle]
pub unsafe extern "C" fn hang_write_video_packet_from_c(data: *const u8, size: usize, keyframe: i32, dts: u64) {
	// Validate pointer and size
	if data.is_null() || size == 0 {
		return;
	}

	if let Some(import_mutex) = IMPORT.get() {
		if let Ok(mut import) = import_mutex.lock() {
			// SAFETY: Caller of hang_write_video_packet_from_c guarantees data is valid
			import.write_video_frame(data, size, keyframe > 0, dts);
		}
	}
}

pub async fn client(url: Url, name: String) -> anyhow::Result<()> {
	let broadcast = moq_lite::Broadcast::produce();
	let config = moq_native::ClientConfig::default();
	let client = config.init()?;

	let connection = client.connect(url).await?;

	let origin = moq_lite::Origin::produce();

	let session = moq_lite::Session::connect(connection, origin.consumer, None).await?;

	let mut import = ImportJoy::new(broadcast.producer);
	import.init();
	let _ = IMPORT.set(Mutex::new(import));

	origin.producer.publish_broadcast(&name, broadcast.consumer);

	while RUNNING.load(Ordering::Relaxed) {
		tokio::time::sleep(Duration::from_millis(30)).await;
	}

	session.close(moq_lite::Error::Cancel);

	Ok(())
}

pub struct ImportJoy {
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
			broadcast,
			catalog: catalog.producer,
			tracks: HashMap::default(),
			sent_one_keyframe: false,
		}
	}

	pub fn init(&mut self) {
		// Produce the catalog
		let mut video_renditions = HashMap::new();

		let (track_name, config) = Self::init_video();
		let track = Track {
			name: track_name.clone(),
			priority: 2,
		};
		let track_produce = track.produce();
		self.broadcast.insert_track(track_produce.consumer);
		video_renditions.insert(track_name, config);

		self.tracks.insert(0, track_produce.producer.into());

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

		self.catalog.publish();
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

	/// # Safety
	///
	/// The caller must ensure that `data` points to a valid buffer of at least `size` bytes
	pub unsafe fn write_video_frame(&mut self, data: *const u8, size: usize, keyframe: bool, dts: u64) {
		if !self.sent_one_keyframe {
			if !keyframe {
				return;
			}
			self.sent_one_keyframe = true;
		}

		let Some(track) = self.tracks.get_mut(&0) else {
			return;
		};

		// Use copy_from_slice to own the data, avoiding use-after-free when C caller frees the buffer
		let payload = Bytes::copy_from_slice(std::slice::from_raw_parts(data, size));

		let timestamp = Timestamp::from_micros(dts);

		let frame = Frame {
			timestamp,
			keyframe,
			payload,
		};

		track.write(frame);
	}
}
