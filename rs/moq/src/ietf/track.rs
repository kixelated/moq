//! IETF moq-transport-14 track status messages

use std::borrow::Cow;

use num_enum::{IntoPrimitive, TryFromPrimitive};

use crate::{
	coding::*,
	ietf::{FilterType, GroupOrder, Message},
	Path,
};

use super::namespace::{decode_namespace, encode_namespace};

/// TrackStatus message (0x0d)
#[derive(Clone, Debug)]
pub struct TrackStatus<'a> {
	pub request_id: u64,
	pub track_namespace: Path<'a>,
	pub track_name: Cow<'a, str>,
}

impl<'a> Message for TrackStatus<'a> {
	const ID: u64 = 0x0d;

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.request_id.encode(w);
		encode_namespace(w, &self.track_namespace);
		self.track_name.encode(w);
		0u8.encode(w); // subscriber priority
		GroupOrder::Descending.encode(w);
		false.encode(w); // forward
		FilterType::LargestObject.encode(w); // filter type
		0u8.encode(w); // no parameters
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let request_id = u64::decode(r)?;
		let track_namespace = decode_namespace(r)?;
		let track_name = Cow::<str>::decode(r)?;

		let _subscriber_priority = u8::decode(r)?;
		let _group_order = GroupOrder::decode(r)?;
		let _forward = bool::decode(r)?;
		let _filter_type = u64::decode(r)?;

		// Ignore parameters, who cares.
		let _params = Parameters::decode(r)?;

		Ok(Self {
			request_id,
			track_namespace,
			track_name,
		})
	}
}

#[derive(Clone, Copy, Debug, TryFromPrimitive, IntoPrimitive)]
#[repr(u64)]
pub enum TrackStatusCode {
	InProgress = 0x00,
	NotFound = 0x01,
	NotAuthorized = 0x02,
	Ended = 0x03,
}

impl Encode for TrackStatusCode {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		u64::from(*self).encode(w);
	}
}

impl Decode for TrackStatusCode {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		Self::try_from(u64::decode(r)?).map_err(|_| DecodeError::InvalidValue)
	}
}
