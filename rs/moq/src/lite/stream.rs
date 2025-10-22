use crate::coding::*;

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum ControlType {
	Session,
	Announce,
	Subscribe,

	// Backwards compatibility with moq-transport 07-09
	ClientCompatV7,
	ServerCompatV7,

	// Backwards compatibility with moq-transport 10-14
	ClientCompatV14,
	ServerCompatV14,
}

impl Decode for ControlType {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let t = u64::decode(r)?;
		match t {
			0 => Ok(Self::Session),
			1 => Ok(Self::Announce),
			2 => Ok(Self::Subscribe),
			0x20 => Ok(Self::ClientCompatV14),
			0x21 => Ok(Self::ServerCompatV14),
			0x40 => Ok(Self::ClientCompatV7),
			0x41 => Ok(Self::ServerCompatV7),
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
			Self::ClientCompatV14 => 0x20,
			Self::ServerCompatV14 => 0x21,
			Self::ClientCompatV7 => 0x40,
			Self::ServerCompatV7 => 0x41,
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
