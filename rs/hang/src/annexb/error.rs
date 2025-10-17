/// Annex-B -specific error types for h264 processing.
#[derive(thiserror::Error, Debug)]
pub enum Error {
	/// An error from the underlying MoQ transport layer.
	#[error("moq error: {0}")]
	Moq(#[from] moq_lite::Error),

	/// An error from the AnnexB parsing library.
	#[error("annexb parser error: {0}")]
	AnnexB(#[from] h264_parser::Error),

	/// An error from the hang media library.
	#[error("hang error: {0}")]
	Hang(#[from] crate::Error),

	/// I/O error occurred while reading the file.
	#[error("io error: {0}")]
	Io(#[from] std::io::Error),
}

/// A Result type alias for AnnexB import operations.
pub type Result<T> = std::result::Result<T, Error>;
