use crate::coding::*;

use num_enum::{IntoPrimitive, TryFromPrimitive};

#[derive(Debug, PartialEq, Clone, Copy, IntoPrimitive, TryFromPrimitive)]
#[repr(u64)]
pub enum ControlType {
	Session = 0,
	Announce = 1,
	Subscribe = 2,

	// Backwards compatibility with moq-transport 07-09
	ClientCompatV7 = 0x40,
	ServerCompatV7 = 0x41,

	// Backwards compatibility with moq-transport 10-14
	ClientCompatV14 = 0x20,
	ServerCompatV14 = 0x21,
}

impl Decode for ControlType {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let t = u64::decode(r)?;
		t.try_into().map_err(|_| DecodeError::InvalidValue)
	}
}

impl Encode for ControlType {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		let v: u64 = (*self).into();
		v.encode(w)
	}
}

#[derive(Debug, PartialEq, Clone, Copy, IntoPrimitive, TryFromPrimitive)]
#[repr(u64)]
pub enum DataType {
	Group = 0,
}

impl Decode for DataType {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let t = u64::decode(r)?;
		t.try_into().map_err(|_| DecodeError::InvalidValue)
	}
}

impl Encode for DataType {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		let v: u64 = (*self).into();
		v.encode(w)
	}
}
