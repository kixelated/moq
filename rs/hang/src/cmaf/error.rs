/// CMAF-specific error types for fMP4 processing.
#[derive(thiserror::Error, Debug)]
pub enum Error {
	/// An error from the underlying MoQ transport layer.
	#[error("moq error: {0}")]
	Moq(#[from] moq_lite::Error),

	/// An error from the MP4 atom parsing library.
	#[error("mp4 error: {0}")]
	Mp4(#[from] mp4_atom::Error),

	/// An error from the hang media library.
	#[error("hang error: {0}")]
	Hang(#[from] crate::Error),

	/// The fMP4 file contains no tracks.
	#[error("missing tracks")]
	MissingTracks,

	/// Referenced a track ID that doesn't exist in the file.
	#[error("unknown track")]
	UnknownTrack,

	/// Required MP4 box is missing from the file structure.
	#[error("missing box: {0}")]
	MissingBox(mp4_atom::FourCC),

	/// Found duplicate MP4 boxes where only one is allowed.
	#[error("duplicate box: {0}")]
	DuplicateBox(mp4_atom::FourCC),

	/// Expected a specific MP4 box type but found something else.
	#[error("expected box: {0}")]
	ExpectedBox(mp4_atom::FourCC),

	/// Encountered an unexpected MP4 box in this context.
	#[error("unexpected box: {0}")]
	UnexpectedBox(mp4_atom::FourCC),

	/// The codec is not supported by hang.
	#[error("unsupported codec: {0}")]
	UnsupportedCodec(String),

	/// Track has no codec information in the sample description.
	#[error("missing codec")]
	MissingCodec,

	/// Track has multiple codecs when only one is expected.
	#[error("multiple codecs")]
	MultipleCodecs,

	/// Invalid size field in MP4 structure.
	#[error("invalid size")]
	InvalidSize,

	/// Initialization segment is empty.
	#[error("empty init")]
	EmptyInit,

	/// Required initialization segment is missing.
	#[error("missing init segment")]
	MissingInit,

	/// Found multiple initialization segments when only one is expected.
	#[error("multiple init segments")]
	MultipleInit,

	/// Unexpected data found after the end of valid MP4 content.
	#[error("trailing data")]
	TrailingData,

	/// The import operation has been closed.
	#[error("closed")]
	Closed,

	/// Invalid data offset in track run or fragment.
	#[error("invalid offset")]
	InvalidOffset,

	/// Track type is not supported (e.g., subtitles).
	#[error("unsupported track: {0}")]
	UnsupportedTrack(&'static str),

	/// I/O error occurred while reading the file.
	#[error("io error: {0}")]
	Io(#[from] std::io::Error),
}

/// A Result type alias for CMAF import operations.
pub type Result<T> = std::result::Result<T, Error>;
