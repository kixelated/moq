use crate::{
	coding::{Decode, DecodeError, Encode},
	Path,
};

/// Sent by the subscriber to request all future objects for the given track.
///
/// Objects will use the provided ID instead of the full track name, to save bytes.
#[derive(Clone, Debug)]
pub struct Subscribe {
	pub id: u64,
	pub broadcast: Path,
	pub track: String,
	pub priority: u8,
}

impl Decode for Subscribe {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let id = u64::decode(r)?;
		let broadcast = Path::decode(r)?;
		let track = String::decode(r)?;
		let priority = u8::decode(r)?;

		Ok(Self {
			id,
			broadcast,
			track,
			priority,
		})
	}
}

impl Encode for Subscribe {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.id.encode(w);
		self.broadcast.encode(w);
		self.track.encode(w);
		self.priority.encode(w);
	}
}

#[derive(Clone, Debug)]
pub struct SubscribeOk {
	pub priority: u8,
}

impl Encode for SubscribeOk {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.priority.encode(w);
	}
}

impl Decode for SubscribeOk {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let priority = u8::decode(r)?;
		Ok(Self { priority })
	}
}
