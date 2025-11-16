use std::borrow::Cow;

use crate::{
	coding::{Decode, DecodeError, Encode},
	lite::Message,
	Path,
};

/// Sent by the subscriber to request all future objects for the given track.
///
/// Objects will use the provided ID instead of the full track name, to save bytes.
#[derive(Clone, Debug)]
pub struct Subscribe<'a> {
	pub id: u64,
	pub broadcast: Path<'a>,
	pub track: Cow<'a, str>,
	pub priority: u8,
	pub expires: std::time::Duration,
}

impl<'a> Message for Subscribe<'a> {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let id = u64::decode(r)?;
		let broadcast = Path::decode(r)?;
		let track = Cow::<str>::decode(r)?;
		let priority = u8::decode(r)?;
		let expires = std::time::Duration::from_millis(u64::decode(r)?);

		Ok(Self {
			id,
			broadcast,
			track,
			priority,
			expires,
		})
	}

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.id.encode(w);
		self.broadcast.encode(w);
		self.track.encode(w);
		self.priority.encode(w);

		let expires: u64 = self.expires.as_millis().try_into().expect("duration too large");
		expires.encode(w);
	}
}

#[derive(Clone, Debug)]
pub struct SubscribeOk {}

// Yes it literally has zero length.
impl Message for SubscribeOk {
	fn encode<W: bytes::BufMut>(&self, _: &mut W) {}
	fn decode<R: bytes::Buf>(_: &mut R) -> Result<Self, DecodeError> {
		Ok(Self {})
	}
}
