use crate::ffi;

pub type Status = i32;

#[derive(Debug, thiserror::Error)]
pub enum Error {
	#[error("closed")]
	Closed,

	#[error("moq error: {0}")]
	Moq(#[from] moq_lite::Error),

	#[error("url error: {0}")]
	Url(#[from] url::ParseError),

	#[error("utf8 error: {0}")]
	Utf8(#[from] std::str::Utf8Error),

	#[error("connect error: {0}")]
	Connect(anyhow::Error),

	#[error("invalid pointer")]
	InvalidPointer,

	#[error("invalid id")]
	InvalidId,

	#[error("not found")]
	NotFound,

	#[error("unknown format")]
	UnknownFormat,

	#[error("init failed: {0}")]
	InitFailed(anyhow::Error),

	#[error("decode failed: {0}")]
	DecodeFailed(anyhow::Error),

	#[error("short decode")]
	ShortDecode,

	#[error("timestamp overflow")]
	TimestampOverflow(#[from] hang::TimestampOverflow),

	#[error("level error: {0}")]
	Level(#[from] tracing::metadata::ParseLevelError),

	#[error("invalid code")]
	InvalidCode,

	#[error("panic")]
	Panic,
}

impl ffi::ReturnCode for Error {
	fn code(&self) -> i32 {
		tracing::error!("{}", self);
		match self {
			Error::Closed => 0,
			Error::Moq(_) => -1,
			Error::Url(_) => -2,
			Error::Utf8(_) => -3,
			Error::Connect(_) => -4,
			Error::InvalidPointer => -5,
			Error::InvalidId => -6,
			Error::NotFound => -7,
			Error::UnknownFormat => -8,
			Error::InitFailed(_) => -9,
			Error::DecodeFailed(_) => -10,
			Error::ShortDecode => -11,
			Error::TimestampOverflow(_) => -12,
			Error::Level(_) => -13,
			Error::InvalidCode => -14,
			Error::Panic => -15,
		}
	}
}
