use crate::coding::{Decode, DecodeError, Encode};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Location {
	pub group: u64,
	pub object: u64,
}

impl<V: Clone> Encode<V> for Location {
	fn encode<W: bytes::BufMut>(&self, w: &mut W, version: V) {
		self.group.encode(w, version.clone());
		self.object.encode(w, version);
	}
}

impl<V: Clone> Decode<V> for Location {
	fn decode<B: bytes::Buf>(buf: &mut B, version: V) -> Result<Self, DecodeError> {
		let group = u64::decode(buf, version.clone())?;
		let object = u64::decode(buf, version)?;
		Ok(Self { group, object })
	}
}
