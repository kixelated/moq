use crate::coding::{DecodeError, Sizer};

use bytes::{Buf, BufMut};

/// A trait for messages that are size-prefixed during encoding/decoding.
///
/// This trait wraps the existing Encode/Decode traits and automatically handles:
/// - Prefixing messages with their encoded size during encoding
/// - Reading the size prefix and validating exact consumption during decoding
/// - Ensuring no bytes are left over or missing after decoding
pub trait Message: Sized {
	const ID: u64;

	/// Encode this message with a size prefix.
	fn encode<W: BufMut>(&self, w: &mut W);

	fn encode_size(&self) -> u16 {
		let mut sizer = Sizer::default();
		self.encode(&mut sizer);
		sizer.size.try_into().expect("message too large")
	}

	/// Decode a size-prefixed message, ensuring exact size consumption.
	fn decode<B: Buf>(buf: &mut B) -> Result<Self, DecodeError>;
}
