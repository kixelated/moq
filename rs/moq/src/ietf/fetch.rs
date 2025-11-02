use std::borrow::Cow;

use crate::{
	coding::{Decode, DecodeError, Encode},
	ietf::{
		namespace::{decode_namespace, encode_namespace},
		GroupOrder, Location, Message, Parameters,
	},
	Path,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FetchType<'a> {
	//
	Standalone {
		namespace: Path<'a>,
		track: Cow<'a, str>,
		start: Location,
		end: Location,
	},
	RelativeJoining {
		subscriber_request_id: u64,
		group_offset: u64,
	},
	AbsoluteJoining {
		subscriber_request_id: u64,
		group_id: u64,
	},
}

impl<'a> Encode for FetchType<'a> {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		match self {
			FetchType::Standalone {
				namespace,
				track,
				start,
				end,
			} => {
				1u8.encode(w);
				encode_namespace(w, namespace);
				track.encode(w);
				start.encode(w);
				end.encode(w);
			}
			FetchType::RelativeJoining {
				subscriber_request_id,
				group_offset,
			} => {
				2u8.encode(w);
				subscriber_request_id.encode(w);
				group_offset.encode(w);
			}
			FetchType::AbsoluteJoining {
				subscriber_request_id,
				group_id,
			} => {
				3u8.encode(w);
				subscriber_request_id.encode(w);
				group_id.encode(w);
			}
		}
	}
}

impl<'a> Decode for FetchType<'a> {
	fn decode<B: bytes::Buf>(buf: &mut B) -> Result<Self, DecodeError> {
		let fetch_type = u64::decode(buf)?;
		Ok(match fetch_type {
			0x1 => {
				let namespace = decode_namespace(buf)?;
				let track = Cow::<str>::decode(buf)?;
				let start = Location::decode(buf)?;
				let end = Location::decode(buf)?;
				FetchType::Standalone {
					namespace,
					track,
					start,
					end,
				}
			}
			0x2 => {
				let subscriber_request_id = u64::decode(buf)?;
				let group_offset = u64::decode(buf)?;
				FetchType::RelativeJoining {
					subscriber_request_id,
					group_offset,
				}
			}
			0x3 => {
				let subscriber_request_id = u64::decode(buf)?;
				let group_id = u64::decode(buf)?;
				FetchType::AbsoluteJoining {
					subscriber_request_id,
					group_id,
				}
			}
			_ => return Err(DecodeError::InvalidValue),
		})
	}
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fetch<'a> {
	pub request_id: u64,
	pub subscriber_priority: u8,
	pub group_order: GroupOrder,
	pub fetch_type: FetchType<'a>,
	// fetch type specific
	// parameters
}

impl<'a> Message for Fetch<'a> {
	const ID: u64 = 0x16;

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.request_id.encode(w);
		self.subscriber_priority.encode(w);
		self.group_order.encode(w);
		self.fetch_type.encode(w);
		// parameters
		0u8.encode(w);
	}

	fn decode<B: bytes::Buf>(buf: &mut B) -> Result<Self, DecodeError> {
		let request_id = u64::decode(buf)?;
		let subscriber_priority = u8::decode(buf)?;
		let group_order = GroupOrder::decode(buf)?;
		let fetch_type = FetchType::decode(buf)?;
		// parameters
		let _params = Parameters::decode(buf)?;
		Ok(Self {
			request_id,
			subscriber_priority,
			group_order,
			fetch_type,
		})
	}
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchOk {
	pub request_id: u64,
	pub group_order: GroupOrder,
	pub end_of_track: bool,
	pub end_location: Location,
	// parameters
}
impl Message for FetchOk {
	const ID: u64 = 0x18;

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.request_id.encode(w);
		self.group_order.encode(w);
		self.end_of_track.encode(w);
		self.end_location.encode(w);
		// parameters
		0u8.encode(w);
	}

	fn decode<B: bytes::Buf>(buf: &mut B) -> Result<Self, DecodeError> {
		let request_id = u64::decode(buf)?;
		let group_order = GroupOrder::decode(buf)?;
		let end_of_track = bool::decode(buf)?;
		let end_location = Location::decode(buf)?;
		// parameters
		let _params = Parameters::decode(buf)?;
		Ok(Self {
			request_id,
			group_order,
			end_of_track,
			end_location,
		})
	}
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchError<'a> {
	pub request_id: u64,
	pub error_code: u64,
	pub reason_phrase: Cow<'a, str>,
}

impl<'a> Message for FetchError<'a> {
	const ID: u64 = 0x19;

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.request_id.encode(w);
		self.error_code.encode(w);
		self.reason_phrase.encode(w);
	}

	fn decode<B: bytes::Buf>(buf: &mut B) -> Result<Self, DecodeError> {
		let request_id = u64::decode(buf)?;
		let error_code = u64::decode(buf)?;
		let reason_phrase = Cow::<str>::decode(buf)?;
		Ok(Self {
			request_id,
			error_code,
			reason_phrase,
		})
	}
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchCancel {
	pub request_id: u64,
}
impl Message for FetchCancel {
	const ID: u64 = 0x17;

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.request_id.encode(w);
	}

	fn decode<B: bytes::Buf>(buf: &mut B) -> Result<Self, DecodeError> {
		let request_id = u64::decode(buf)?;
		Ok(Self { request_id })
	}
}

pub struct FetchHeader {
	pub request_id: u64,
}

impl FetchHeader {
	pub const TYPE: u64 = 0x5;
}

impl Encode for FetchHeader {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.request_id.encode(w);
	}
}

impl Decode for FetchHeader {
	fn decode<B: bytes::Buf>(buf: &mut B) -> Result<Self, DecodeError> {
		let request_id = u64::decode(buf)?;
		Ok(Self { request_id })
	}
}

// Currently unused.
pub struct FetchObject {
	/*
	Group ID (i),
	Subgroup ID (i),
	Object ID (i),
	Publisher Priority (8),
	Extension Headers Length (i),
	[Extension headers (...)],
	Object Payload Length (i),
	[Object Status (i)],
	Object Payload (..),
	*/
}
