//! IETF moq-transport-14 subscribe messages

use std::borrow::Cow;

use num_enum::{IntoPrimitive, TryFromPrimitive};

use crate::{
	coding::*,
	ietf::{GroupOrder, Location, Message, Parameters},
	Path,
};

use super::namespace::{decode_namespace, encode_namespace};

#[derive(Clone, Copy, Debug, TryFromPrimitive, IntoPrimitive)]
#[repr(u64)]
pub enum FilterType {
	NextGroup = 0x01,
	LargestObject = 0x2,
	AbsoluteStart = 0x3,
	AbsoluteRange = 0x4,
}

impl Encode for FilterType {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		u64::from(*self).encode(w);
	}
}

impl Decode for FilterType {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		Self::try_from(u64::decode(r)?).map_err(|_| DecodeError::InvalidValue)
	}
}

/// Subscribe message (0x03)
/// Sent by the subscriber to request all future objects for the given track.
#[derive(Clone, Debug)]
pub struct Subscribe<'a> {
	pub request_id: u64,
	pub track_namespace: Path<'a>,
	pub track_name: Cow<'a, str>,
	pub subscriber_priority: u8,
	pub group_order: GroupOrder,
	pub filter_type: FilterType,
}

impl<'a> Message for Subscribe<'a> {
	const ID: u64 = 0x03;

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let request_id = u64::decode(r)?;

		// Decode namespace (tuple of strings)
		let track_namespace = decode_namespace(r)?;

		let track_name = Cow::<str>::decode(r)?;
		let subscriber_priority = u8::decode(r)?;

		let group_order = GroupOrder::decode(r)?;

		let forward = bool::decode(r)?;
		if !forward {
			return Err(DecodeError::Unsupported);
		}

		let filter_type = FilterType::decode(r)?;
		match filter_type {
			FilterType::AbsoluteStart => {
				let _start = Location::decode(r)?;
			}
			FilterType::AbsoluteRange => {
				let _start = Location::decode(r)?;
				let _end_group = u64::decode(r)?;
			}
			FilterType::NextGroup | FilterType::LargestObject => {}
		};

		// Ignore parameters, who cares.
		let _params = Parameters::decode(r)?;

		Ok(Self {
			request_id,
			track_namespace,
			track_name,
			subscriber_priority,
			group_order,
			filter_type,
		})
	}

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.request_id.encode(w);
		encode_namespace(w, &self.track_namespace);
		self.track_name.encode(w);
		self.subscriber_priority.encode(w);
		GroupOrder::Descending.encode(w);
		true.encode(w); // forward

		assert!(
			!matches!(self.filter_type, FilterType::AbsoluteStart | FilterType::AbsoluteRange),
			"Absolute subscribe not supported"
		);

		self.filter_type.encode(w);
		0u8.encode(w); // no parameters
	}
}

/// SubscribeOk message (0x04)
#[derive(Clone, Debug)]
pub struct SubscribeOk {
	pub request_id: u64,
	pub track_alias: u64,
}

impl Message for SubscribeOk {
	const ID: u64 = 0x04;

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.request_id.encode(w);
		self.track_alias.encode(w);
		0u64.encode(w); // expires = 0
		GroupOrder::Descending.encode(w);
		false.encode(w); // no content
		0u8.encode(w); // no parameters
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let request_id = u64::decode(r)?;
		let track_alias = u64::decode(r)?;

		let expires = u64::decode(r)?;
		if expires != 0 {
			return Err(DecodeError::Unsupported);
		}

		// Ignore group order, who cares.
		let _group_order = u8::decode(r)?;

		// TODO: We don't support largest group/object yet
		if bool::decode(r)? {
			let _group = u64::decode(r)?;
			let _object = u64::decode(r)?;
		}

		// Ignore parameters, who cares.
		let _params = Parameters::decode(r)?;

		Ok(Self {
			request_id,
			track_alias,
		})
	}
}

/// SubscribeError message (0x05)
#[derive(Clone, Debug)]
pub struct SubscribeError<'a> {
	pub request_id: u64,
	pub error_code: u64,
	pub reason_phrase: Cow<'a, str>,
}

impl<'a> Message for SubscribeError<'a> {
	const ID: u64 = 0x05;

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.request_id.encode(w);
		self.error_code.encode(w);
		self.reason_phrase.encode(w);
	}
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let request_id = u64::decode(r)?;
		let error_code = u64::decode(r)?;
		let reason_phrase = Cow::<str>::decode(r)?;

		Ok(Self {
			request_id,
			error_code,
			reason_phrase,
		})
	}
}

/// Unsubscribe message (0x0a)
#[derive(Clone, Debug)]
pub struct Unsubscribe {
	pub request_id: u64,
}

impl Message for Unsubscribe {
	const ID: u64 = 0x0a;

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.request_id.encode(w);
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let request_id = u64::decode(r)?;
		Ok(Self { request_id })
	}
}

/*
  Type (i) = 0x2,
  Length (16),
  Request ID (i),
  Subscription Request ID (i),
  Start Location (Location),
  End Group (i),
  Subscriber Priority (8),
  Forward (8),
  Number of Parameters (i),
  Parameters (..) ...
*/
#[derive(Debug)]
pub struct SubscribeUpdate {
	pub request_id: u64,
	pub subscription_request_id: u64,
	pub start_location: Location,
	pub end_group: u64,
	pub subscriber_priority: u8,
	pub forward: bool,
	// pub parameters: Parameters,
}

impl Message for SubscribeUpdate {
	const ID: u64 = 0x02;

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.request_id.encode(w);
		self.subscription_request_id.encode(w);
		self.start_location.encode(w);
		self.end_group.encode(w);
		self.subscriber_priority.encode(w);
		self.forward.encode(w);
		0u8.encode(w); // no parameters
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let request_id = u64::decode(r)?;
		let subscription_request_id = u64::decode(r)?;
		let start_location = Location::decode(r)?;
		let end_group = u64::decode(r)?;
		let subscriber_priority = u8::decode(r)?;
		let forward = bool::decode(r)?;
		let _parameters = Parameters::decode(r)?;

		Ok(Self {
			request_id,
			subscription_request_id,
			start_location,
			end_group,
			subscriber_priority,
			forward,
		})
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use bytes::BytesMut;

	fn encode_message<M: Message>(msg: &M) -> Vec<u8> {
		let mut buf = BytesMut::new();
		msg.encode(&mut buf);
		buf.to_vec()
	}

	fn decode_message<M: Message>(bytes: &[u8]) -> Result<M, DecodeError> {
		let mut buf = bytes::Bytes::from(bytes.to_vec());
		M::decode(&mut buf)
	}

	#[test]
	fn test_subscribe_round_trip() {
		let msg = Subscribe {
			request_id: 1,
			track_namespace: Path::new("test"),
			track_name: "video".into(),
			subscriber_priority: 128,
			group_order: GroupOrder::Descending,
			filter_type: FilterType::LargestObject,
		};

		let encoded = encode_message(&msg);
		let decoded: Subscribe = decode_message(&encoded).unwrap();

		assert_eq!(decoded.request_id, 1);
		assert_eq!(decoded.track_namespace.as_str(), "test");
		assert_eq!(decoded.track_name, "video");
		assert_eq!(decoded.subscriber_priority, 128);
	}

	#[test]
	fn test_subscribe_nested_namespace() {
		let msg = Subscribe {
			request_id: 100,
			track_namespace: Path::new("conference/room123"),
			track_name: "audio".into(),
			subscriber_priority: 255,
			group_order: GroupOrder::Descending,
			filter_type: FilterType::LargestObject,
		};

		let encoded = encode_message(&msg);
		let decoded: Subscribe = decode_message(&encoded).unwrap();

		assert_eq!(decoded.track_namespace.as_str(), "conference/room123");
	}

	#[test]
	fn test_subscribe_ok() {
		let msg = SubscribeOk {
			request_id: 42,
			track_alias: 42,
		};

		let encoded = encode_message(&msg);
		let decoded: SubscribeOk = decode_message(&encoded).unwrap();

		assert_eq!(decoded.request_id, 42);
	}

	#[test]
	fn test_subscribe_error() {
		let msg = SubscribeError {
			request_id: 123,
			error_code: 500,
			reason_phrase: "Not found".into(),
		};

		let encoded = encode_message(&msg);
		let decoded: SubscribeError = decode_message(&encoded).unwrap();

		assert_eq!(decoded.request_id, 123);
		assert_eq!(decoded.error_code, 500);
		assert_eq!(decoded.reason_phrase, "Not found");
	}

	#[test]
	fn test_unsubscribe() {
		let msg = Unsubscribe { request_id: 999 };

		let encoded = encode_message(&msg);
		let decoded: Unsubscribe = decode_message(&encoded).unwrap();

		assert_eq!(decoded.request_id, 999);
	}

	#[test]
	fn test_subscribe_rejects_invalid_filter_type() {
		#[rustfmt::skip]
		let invalid_bytes = vec![
			0x01, // subscribe_id
			0x02, // track_alias
			0x01, // namespace length
			0x04, 0x74, 0x65, 0x73, 0x74, // "test"
			0x05, 0x76, 0x69, 0x64, 0x65, 0x6f, // "video"
			0x80, // subscriber_priority
			0x02, // group_order
			0x99, // INVALID filter_type
			0x00, // num_params
		];

		let result: Result<Subscribe, _> = decode_message(&invalid_bytes);
		assert!(result.is_err());
	}

	#[test]
	fn test_subscribe_ok_rejects_non_zero_expires() {
		#[rustfmt::skip]
		let invalid_bytes = vec![
			0x01, // subscribe_id
			0x05, // INVALID: expires = 5
			0x02, // group_order
			0x00, // content_exists
			0x00, // num_params
		];

		let result: Result<SubscribeOk, _> = decode_message(&invalid_bytes);
		assert!(result.is_err());
	}
}
