//! IETF moq-transport-07 subscribe messages

use std::borrow::Cow;

use crate::{coding::*, ietf::Message, Path};

use super::namespace::{decode_namespace, encode_namespace};

// We only support Latest Group (0x1)
const FILTER_TYPE: u8 = 0x01;

// We only support Group Order descending (0x02)
const GROUP_ORDER: u8 = 0x02;

/// Subscribe message (0x03)
/// Sent by the subscriber to request all future objects for the given track.
#[derive(Clone, Debug)]
pub struct Subscribe<'a> {
	pub request_id: u64,
	pub track_namespace: Path<'a>,
	pub track_name: Cow<'a, str>,
	pub subscriber_priority: u8,
}

impl<'a> Message for Subscribe<'a> {
	const ID: u64 = 0x03;

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let request_id = u64::decode(r)?;

		// Decode namespace (tuple of strings)
		let track_namespace = decode_namespace(r)?;

		let track_name = Cow::<str>::decode(r)?;
		let subscriber_priority = u8::decode(r)?;

		// Ignore group order, we're sending it descending anyway.
		let _group_order = u8::decode(r)?;

		let forward = bool::decode(r)?;
		if !forward {
			return Err(DecodeError::Unsupported);
		}

		let filter_type = u8::decode(r)?;
		if filter_type != FILTER_TYPE {
			return Err(DecodeError::Unsupported);
		}

		// Ignore parameters, who cares.
		let _params = Extensions::decode(r)?;

		Ok(Self {
			request_id,
			track_namespace,
			track_name,
			subscriber_priority,
		})
	}

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.request_id.encode(w);
		encode_namespace(w, &self.track_namespace);
		self.track_name.encode(w);
		self.subscriber_priority.encode(w);
		GROUP_ORDER.encode(w);
		true.encode(w); // forward
		FILTER_TYPE.encode(w);
		0u8.encode(w); // no parameters
	}
}

/// SubscribeOk message (0x04)
#[derive(Clone, Debug)]
pub struct SubscribeOk {
	pub request_id: u64,
}

impl Message for SubscribeOk {
	const ID: u64 = 0x04;

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.request_id.encode(w);
		self.request_id.encode(w); // TODO track_alias == request_id for now
		0u64.encode(w); // expires = 0
		GROUP_ORDER.encode(w);
		false.encode(w); // no content
		0u8.encode(w); // no parameters
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let request_id = u64::decode(r)?;

		let track_alias = u64::decode(r)?;
		if track_alias != request_id {
			// TODO We don't support track aliases yet; they are dumb.
			return Err(DecodeError::Unsupported);
		}

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
		let _params = Extensions::decode(r)?;

		Ok(Self { request_id })
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

pub struct SubscribeUpdate {}

impl SubscribeUpdate {
	pub const ID: u64 = 0x02;
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
		};

		let encoded = encode_message(&msg);
		let decoded: Subscribe = decode_message(&encoded).unwrap();

		assert_eq!(decoded.track_namespace.as_str(), "conference/room123");
	}

	#[test]
	fn test_subscribe_ok() {
		let msg = SubscribeOk { request_id: 42 };

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
