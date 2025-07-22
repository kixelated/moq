use bytes::{Buf, BufMut};

use super::{Decode, DecodeError, Encode, Sizer};

/// A trait for messages that are automatically size-prefixed during encoding/decoding.
///
/// This trait wraps the existing Encode/Decode traits and automatically handles:
/// - Prefixing messages with their encoded size during encoding
/// - Reading the size prefix and validating exact consumption during decoding
/// - Ensuring no bytes are left over or missing after decoding
pub trait Message: Sized {
	/// Encode this message with a size prefix.
	fn encode<W: BufMut>(&self, w: &mut W);

	/// Decode a size-prefixed message, ensuring exact size consumption.
	fn decode<B: Buf>(buf: &mut B) -> Result<Self, DecodeError>;
}

// Blanket implementation for all types that implement Encode + Decode
impl<T: Message> Encode for T {
	fn encode<W: BufMut>(&self, w: &mut W) {
		let mut sizer = Sizer::default();
		Message::encode(self, &mut sizer);
		sizer.size.encode(w);
		Message::encode(self, w);
	}
}

impl<T: Message> Decode for T {
	fn decode<B: Buf>(buf: &mut B) -> Result<Self, DecodeError> {
		let size = usize::decode(buf)?;
		let mut limited = buf.take(size);
		let result = Message::decode(&mut limited)?;
		if limited.remaining() > 0 {
			return Err(DecodeError::TooManyBytes);
		}

		Ok(result)
	}
}
