use crate::{
	coding::{Decode, DecodeError, Encode},
	ietf::Message,
};

#[derive(Clone, Debug)]
pub struct MaxRequestId {
	pub request_id: u64,
}

impl Message for MaxRequestId {
	const ID: u64 = 0x15;

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.request_id.encode(w);
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let request_id = u64::decode(r)?;
		Ok(Self { request_id })
	}
}
