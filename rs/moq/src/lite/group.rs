use crate::{coding::*, lite::Message};

#[derive(Clone, Debug)]
pub struct Group {
	// The subscribe ID.
	pub subscribe: u64,

	// The group sequence number
	pub sequence: u64,
}

impl Message for Group {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		Ok(Self {
			subscribe: u64::decode(r)?,
			sequence: u64::decode(r)?,
		})
	}

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.subscribe.encode(w);
		self.sequence.encode(w);
	}
}
