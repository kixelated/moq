use crate::coding::{Decode, DecodeError, Encode};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Location {
	pub group: u64,
	pub object: u64,
}

impl Encode for Location {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.group.encode(w);
		self.object.encode(w);
	}
}

impl Decode for Location {
	fn decode<B: bytes::Buf>(buf: &mut B) -> Result<Self, DecodeError> {
		let group = u64::decode(buf)?;
		let object = u64::decode(buf)?;
		Ok(Self { group, object })
	}
}
