use crate::{coding, message};

/// A list of possible errors that can occur during the session.
#[derive(thiserror::Error, Debug)]
pub enum Error {
	#[error("transport error: {0}")]
	Transport(Box<dyn std::error::Error + Send + Sync>),

	#[error("decode error: {0}")]
	Decode(#[from] coding::DecodeError),

	// TODO move to a ConnectError
	#[error("unsupported versions: client={0:?} server={1:?}")]
	Version(message::Versions, message::Versions),

	/// A required extension was not present
	#[error("extension required: {0}")]
	RequiredExtension(u64),

	/// An unexpected stream was received
	#[error("unexpected stream: {0:?}")]
	UnexpectedStream(message::ControlType),

	/// Some VarInt was too large and we were too lazy to handle it
	#[error("varint bounds exceeded")]
	BoundsExceeded(#[from] coding::BoundsExceeded),

	/// A duplicate ID was used
	// The broadcast/track is a duplicate
	#[error("duplicate")]
	Duplicate,

	// Cancel is returned when there are no more readers.
	#[error("cancelled")]
	Cancel,

	/// It took too long to open or transmit a stream.
	#[error("timeout")]
	Timeout,

	/// The group is older than the latest group and dropped.
	#[error("old")]
	Old,

	// The application closes the stream with a code.
	#[error("app code={0}")]
	App(u32),

	#[error("not found")]
	NotFound,

	#[error("wrong frame size")]
	WrongSize,

	#[error("protocol violation")]
	ProtocolViolation,

	#[error("unauthorized")]
	Unauthorized,
}

impl Error {
	/// An integer code that is sent over the wire.
	pub fn to_code(&self) -> u32 {
		match self {
			Self::Cancel => 0,
			Self::RequiredExtension(_) => 1,
			Self::Old => 2,
			Self::Timeout => 3,
			Self::Transport(_) => 4,
			Self::Decode(_) => 5,
			Self::Unauthorized => 6,
			Self::Version(..) => 9,
			Self::UnexpectedStream(_) => 10,
			Self::BoundsExceeded(_) => 11,
			Self::Duplicate => 12,
			Self::NotFound => 13,
			Self::WrongSize => 14,
			Self::ProtocolViolation => 15,
			Self::App(app) => *app + 64,
		}
	}
}

impl Clone for Error {
	fn clone(&self) -> Self {
		match self {
			Error::Transport(_) => Error::Transport(Box::new(std::io::Error::new(
				std::io::ErrorKind::Other,
				"Transport error (cloned)",
			))),
			Error::Decode(e) => Error::Decode(e.clone()),
			Error::Version(v1, v2) => Error::Version(v1.clone(), v2.clone()),
			Error::RequiredExtension(e) => Error::RequiredExtension(*e),
			Error::UnexpectedStream(s) => Error::UnexpectedStream(*s),
			Error::BoundsExceeded(b) => Error::BoundsExceeded(b.clone()),
			Error::Duplicate => Error::Duplicate,
			Error::Cancel => Error::Cancel,
			Error::Timeout => Error::Timeout,
			Error::Old => Error::Old,
			Error::App(code) => Error::App(*code),
			Error::NotFound => Error::NotFound,
			Error::WrongSize => Error::WrongSize,
			Error::ProtocolViolation => Error::ProtocolViolation,
			Error::Unauthorized => Error::Unauthorized,
		}
	}
}

impl From<web_transport_quinn::SessionError> for Error {
	fn from(err: web_transport_quinn::SessionError) -> Self {
		Error::Transport(Box::new(err))
	}
}

pub type Result<T> = std::result::Result<T, Error>;
