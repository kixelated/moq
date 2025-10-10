use crate::coding::{Decode, DecodeError, Encode, Extension};

pub enum Role {
	Publisher,
	Subscriber,
	Both,
}

impl Encode for Role {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		let v: u64 = match self {
			Role::Publisher => 0x01,
			Role::Subscriber => 0x02,
			Role::Both => 0x03,
		};
		v.encode(w);
	}
}

impl Decode for Role {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let value = u64::decode(r)?;
		Ok(match value {
			0x01 => Role::Publisher,
			0x02 => Role::Subscriber,
			0x03 => Role::Both,
			_ => return Err(DecodeError::InvalidValue),
		})
	}
}

impl Extension for Role {
	fn id() -> u64 {
		0x00
	}
}
