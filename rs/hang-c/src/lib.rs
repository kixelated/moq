mod error;
mod ffi;
mod state;

pub use error::*;
use state::*;

use std::ffi::c_void;
use std::os::raw::c_char;
use std::str::FromStr;

use tracing::Level;

/// Initialize the library with a log level.
///
/// This should be called before any other functions.
/// The log_level is a string: "error", "warn", "info", "debug", "trace"
///
/// # Safety
/// - The caller must ensure that level is a valid null-terminated C string.
#[no_mangle]
pub unsafe extern "C" fn hang_log_level(level: *const c_char) -> i32 {
	ffi::return_code(move || {
		match ffi::parse_str(level)? {
			"" => moq_native::Log::default(),
			level => moq_native::Log {
				level: Level::from_str(level)?,
			},
		}
		.init();

		Ok(())
	})
}

/// Start establishing a connection to a MoQ server.
///
/// This may be called multiple times to connect to different servers.
/// Broadcast may be published before or after the connection is established.
///
/// Returns a handle to the session.
/// You should call [hang_session_close], even on error, to free up resources.
///
/// The callback is called on success (status 0) and later when closed (status non-zero).
///
/// # Safety
/// - The caller must ensure that url is a valid null-terminated C string.
/// - The caller must ensure that callback is a valid function pointer, or null.
/// - The caller must ensure that user_data is a valid pointer.
#[no_mangle]
pub unsafe extern "C" fn hang_session_connect(
	url: *const c_char,
	callback: Option<extern "C" fn(user_data: *mut c_void, code: i32)>,
	user_data: *mut c_void,
) -> i32 {
	ffi::return_code(move || {
		let url = ffi::parse_url(url)?;
		let callback = ffi::Callback::new(user_data, callback);
		State::lock().session_connect(url, callback)
	})
}

/// Close a connection to a MoQ server.
///
/// Uses the id returned from [hang_session_connect].
/// Any [hang_session_on_close] callbacks will be fired with [Error::Closed].
#[no_mangle]
pub extern "C" fn hang_session_close(id: i32) -> i32 {
	ffi::return_code(move || {
		let id = ffi::parse_id(id)?;
		State::lock().session_close(id)
	})
}

/// Create a new broadcast; a collection of tracks.
///
/// Returns a handle to the broadcast for [hang_broadcast_close].
#[no_mangle]
pub extern "C" fn hang_broadcast_create() -> i32 {
	ffi::return_code(move || State::lock().create_broadcast())
}

/// Remove a broadcast and all its tracks.
///
/// Uses the id returned from [hang_broadcast_create].
#[no_mangle]
pub extern "C" fn hang_broadcast_close(id: i32) -> i32 {
	ffi::return_code(move || {
		let id = ffi::parse_id(id)?;
		State::lock().remove_broadcast(id)
	})
}

/// Publish the broadcast to the indicated session with the given path.
///
/// This allows publishing the same broadcast multiple times to different connections.
///
/// # Safety
/// - The caller must ensure that path is a valid null-terminated C string, or null.
// TODO add an unpublish method.
#[no_mangle]
pub unsafe extern "C" fn hang_broadcast_publish(id: i32, session: i32, path: *const c_char) -> i32 {
	ffi::return_code(move || {
		let id = ffi::parse_id(id)?;
		let session = ffi::parse_id(session)?;
		let path = ffi::parse_str(path)?;
		State::lock().publish_broadcast(id, session, path)
	})
}

/// Create a new track for a broadcast.
///
/// The contents of `extra` depends on the `format`.
/// See [hang::import::Generic] for the available formats.
///
/// Returns a handle to the track for [hang_track_close] and [hang_track_write].
///
/// # Safety
/// - The caller must ensure that format is a valid null-terminated C string.
#[no_mangle]
pub unsafe extern "C" fn hang_track_create(broadcast: i32, format: *const c_char) -> i32 {
	ffi::return_code(move || {
		let broadcast = ffi::parse_id(broadcast)?;
		let format = ffi::parse_str(format)?;

		State::lock().create_track(broadcast, format)
	})
}

/// Remove a track from a broadcast.
///
/// Uses the id returned from [hang_track_create].
#[no_mangle]
pub extern "C" fn hang_track_close(id: i32) -> i32 {
	ffi::return_code(move || {
		let id = ffi::parse_id(id)?;
		State::lock().remove_track(id)
	})
}

/// Initialize a track with extra data.
///
/// Uses the id returned from [hang_track_create].
///
/// # Safety
/// - The caller must ensure that extra is a valid pointer, or null.
#[no_mangle]
pub unsafe extern "C" fn hang_track_init(id: i32, extra: *const u8, extra_size: usize) -> i32 {
	ffi::return_code(move || {
		let id = ffi::parse_id(id)?;
		let extra = ffi::parse_slice(extra, extra_size)?;
		State::lock().init_track(id, extra)
	})
}

/// Write data to a track.
///
/// The data encoding depends on the configured `format`.
/// The timestamp is in microseconds.
///
/// Uses the id returned from [hang_track_create].
///
/// # Safety
/// - The caller must ensure that data is a valid pointer, or null.
#[no_mangle]
pub unsafe extern "C" fn hang_track_write(id: i32, data: *const u8, data_size: usize, pts: u64) -> i32 {
	ffi::return_code(move || {
		let id = ffi::parse_id(id)?;
		let data = ffi::parse_slice(data, data_size)?;
		State::lock().write_track(id, data, pts)
	})
}
