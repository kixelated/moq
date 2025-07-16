use moq_lite::coding::*;

use derive_more::Debug;

/// A timestamp representing the presentation time of a media frame.
///
/// This is currently just a type alias for `std::time::Duration`.
/// In the future it will have a more concrete type.
pub type Timestamp = std::time::Duration;

/// A media frame with a timestamp and codec-specific payload.
///
/// Frames are the fundamental unit of media data in hang. Each frame contains:
/// - A timestamp when they should be rendered.
/// - A keyframe flag indicating whether this frame can be decoded independently
/// - A codec-specific payload.
#[derive(Clone, Debug)]
pub struct Frame {
	/// The presentation timestamp for this frame.
	///
	/// This indicates when the frame should be displayed relative to the
	/// start of the stream or some other reference point.
	/// This is NOT a wall clock time.
	pub timestamp: Timestamp,

	/// Whether this frame is a keyframe (can be decoded independently).
	///
	/// Keyframes are used as group boundaries and entry points for new subscribers.
	/// It's necessary to periodically encode keyframes to support new subscribers.
	pub keyframe: bool,

	/// The encoded media data for this frame.
	///
	/// The format depends on the codec being used (H.264, AV1, Opus, etc.).
	/// The debug implementation shows only the payload length for brevity.
	#[debug("{} bytes", payload.len())]
	pub payload: Bytes,
}
