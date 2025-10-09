//! IETF moq-transport-07 goaway message

use std::borrow::Cow;

use crate::coding::*;

/// GoAway message (0x10)
#[derive(Clone, Debug)]
pub struct GoAway<'a> {
	pub new_session_uri: Cow<'a, str>,
}

impl<'a> Message for GoAway<'a> {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.new_session_uri.encode(w);
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let new_session_uri = Cow::<str>::decode(r)?;
		Ok(Self { new_session_uri })
	}
}
