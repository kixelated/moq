use crate::{
	coding::{Decode, DecodeError, Encode, Message},
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

impl Message for Subscribe {
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

impl Message for SubscribeOk {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.priority.encode(w);
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let priority = u8::decode(r)?;
		Ok(Self { priority })
	}
}
