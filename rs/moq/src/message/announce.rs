use num_enum::{IntoPrimitive, TryFromPrimitive};

use crate::{coding::*, Path};

/// Sent by the publisher to announce the availability of a track.
/// The payload contains the contents of the wildcard.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum Announce<'a> {
	Active {
		#[cfg_attr(feature = "serde", serde(borrow))]
		suffix: Path<'a>,
	},
	Ended {
		#[cfg_attr(feature = "serde", serde(borrow))]
		suffix: Path<'a>,
	},
}

impl<'a> Announce<'a> {
	pub fn suffix(&self) -> &Path<'a> {
		match self {
			Announce::Active { suffix } => suffix,
			Announce::Ended { suffix } => suffix,
		}
	}
}

impl<'a> Message for Announce<'a> {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		Ok(match AnnounceStatus::decode(r)? {
			AnnounceStatus::Active => Self::Active {
				suffix: Path::decode(r)?,
			},
			AnnounceStatus::Ended => Self::Ended {
				suffix: Path::decode(r)?,
			},
		})
	}

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		match self {
			Self::Active { suffix } => {
				AnnounceStatus::Active.encode(w);
				suffix.encode(w);
			}
			Self::Ended { suffix } => {
				AnnounceStatus::Ended.encode(w);
				suffix.encode(w);
			}
		}
	}
}

/// Sent by the subscriber to request ANNOUNCE messages.
#[derive(Clone, Debug)]
pub struct AnnouncePlease<'a> {
	// Request tracks with this prefix.
	pub prefix: Path<'a>,
}

impl<'a> Message for AnnouncePlease<'a> {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let prefix = Path::decode(r)?;
		Ok(Self { prefix })
	}

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.prefix.encode(w)
	}
}

/// Send by the publisher, used to determine the message that follows.
#[derive(Clone, Copy, Debug, IntoPrimitive, TryFromPrimitive)]
#[repr(u8)]
enum AnnounceStatus {
	Ended = 0,
	Active = 1,
}

impl Decode for AnnounceStatus {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let status = u8::decode(r)?;
		match status {
			0 => Ok(Self::Ended),
			1 => Ok(Self::Active),
			_ => Err(DecodeError::InvalidValue),
		}
	}
}

impl Encode for AnnounceStatus {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		(*self as u8).encode(w)
	}
}

/// Sent after setup to communicate the initially announced paths.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AnnounceInit<'a> {
	/// List of currently active broadcasts, encoded as suffixes to be combined with the prefix.
	#[cfg_attr(feature = "serde", serde(borrow))]
	pub suffixes: Vec<Path<'a>>,
}

impl<'a> Message for AnnounceInit<'a> {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let count = u64::decode(r)?;

		// Don't allocate more than 1024 elements upfront
		let mut paths = Vec::with_capacity(count.min(1024) as usize);

		for _ in 0..count {
			paths.push(Path::decode(r)?);
		}

		Ok(Self { suffixes: paths })
	}

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		(self.suffixes.len() as u64).encode(w);
		for path in &self.suffixes {
			path.encode(w);
		}
	}
}
