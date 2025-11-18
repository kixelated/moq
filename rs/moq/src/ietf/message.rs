use crate::coding::{self, DecodeError, Sizer};
use crate::ietf::Version;
use std::fmt::Debug;

use bytes::{Buf, BufMut};

/// A trait for messages that are size-prefixed during encoding/decoding.
///
/// This trait wraps the existing Encode/Decode traits and automatically handles:
/// - Prefixing messages with their encoded size during encoding
/// - Reading the size prefix and validating exact consumption during decoding
/// - Ensuring no bytes are left over or missing after decoding
pub trait Message: Sized + Debug {
	const ID: u64;

	/// Encode this message with a size prefix.
	fn encode<W: BufMut>(&self, w: &mut W, version: Version);

	/// Decode a size-prefixed message, ensuring exact size consumption.
	fn decode<B: Buf>(buf: &mut B, version: Version) -> Result<Self, DecodeError>;
}

impl<T: Message> coding::Encode<Version> for T {
	fn encode<W: BufMut>(&self, w: &mut W, version: Version) {
		// TODO Always encode 2 bytes for the size, then go back and populate it later.
		// That way we can avoid calculating the size upfront.
		let mut sizer = Sizer::default();
		self.encode(&mut sizer, version);
		let size: u16 = sizer.size.try_into().expect("message too large");
		size.encode(w, version);
		self.encode(w, version);
	}
}

impl<T: Message> coding::Decode<Version> for T {
	fn decode<B: Buf>(buf: &mut B, version: Version) -> Result<Self, DecodeError> {
		let size = u16::decode(buf, version)?;
		let mut limited = buf.take(size as usize);
		let result = Self::decode(&mut limited, version)?;
		if limited.remaining() > 0 {
			return Err(DecodeError::Long);
		}
		Ok(result)
	}
}
