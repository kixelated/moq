use crate::{
	coding::{Decode, DecodeError, Encode},
	ietf::Message,
};

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct RequestId(pub u64);

impl RequestId {
	pub fn increment(&mut self) -> RequestId {
		let prev = self.0;
		self.0 += 2;
		RequestId(prev)
	}
}

impl std::fmt::Display for RequestId {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		write!(f, "{}", self.0)
	}
}

impl Encode for RequestId {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.0.encode(w);
	}
}

impl Decode for RequestId {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let request_id = u64::decode(r)?;
		Ok(Self(request_id))
	}
}

#[derive(Clone, Debug)]
pub struct MaxRequestId {
	pub request_id: RequestId,
}

impl Message for MaxRequestId {
	const ID: u64 = 0x15;

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.request_id.encode(w);
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let request_id = RequestId::decode(r)?;
		Ok(Self { request_id })
	}
}

#[derive(Clone, Debug)]
pub struct RequestsBlocked {
	pub request_id: RequestId,
}

impl Message for RequestsBlocked {
	const ID: u64 = 0x1a;

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.request_id.encode(w);
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let request_id = RequestId::decode(r)?;
		Ok(Self { request_id })
	}
}
