use crate::coding::*;

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum ControlType {
	Session,
	Announce,
	Subscribe,

	// Backwards compatibility with moq-transport-10
	ClientCompat,
	ServerCompat,
}

impl Decode for ControlType {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let t = u64::decode(r)?;
		match t {
			0 => Ok(Self::Session),
			1 => Ok(Self::Announce),
			2 => Ok(Self::Subscribe),
			0x40 => Ok(Self::ClientCompat),
			0x41 => Ok(Self::ServerCompat),
			_ => Err(DecodeError::InvalidMessage(t)),
		}
	}
}

impl Encode for ControlType {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		let v: u64 = match self {
			Self::Session => 0,
			Self::Announce => 1,
			Self::Subscribe => 2,
			Self::ClientCompat => 0x40,
			Self::ServerCompat => 0x41,
		};
		v.encode(w)
	}
}

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum DataType {
	Group,
}

impl Decode for DataType {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let t = u64::decode(r)?;
		match t {
			0 => Ok(Self::Group),
			_ => Err(DecodeError::InvalidMessage(t)),
		}
	}
}

impl Encode for DataType {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		let v: u64 = match self {
			Self::Group => 0,
		};
		v.encode(w)
	}
}
