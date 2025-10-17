//! IETF moq-transport-07 subscribe messages

use std::borrow::Cow;

use crate::{coding::*, Path};

use super::util::{decode_namespace, encode_namespace};

// We only support Latest Group (0x1)
const FILTER_TYPE: u8 = 0x01;

// We only support Group Order descending (0x02)
const GROUP_ORDER: u8 = 0x02;

/// Subscribe message (0x03)
/// Sent by the subscriber to request all future objects for the given track.
#[derive(Clone, Debug)]
pub struct Subscribe<'a> {
	pub subscribe_id: u64,
	pub track_alias: u64,
	pub track_namespace: Path<'a>,
	pub track_name: Cow<'a, str>,
	pub subscriber_priority: u8,
}

impl<'a> Message for Subscribe<'a> {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let subscribe_id = u64::decode(r)?;
		let track_alias = u64::decode(r)?;

		// Decode namespace (tuple of strings)
		let track_namespace = decode_namespace(r)?;

		let track_name = Cow::<str>::decode(r)?;
		let subscriber_priority = u8::decode(r)?;

		let group_order = u8::decode(r)?;
		if group_order != 0 && group_order != GROUP_ORDER {
			return Err(DecodeError::InvalidValue);
		}

		let filter_type = u8::decode(r)?;
		if filter_type != FILTER_TYPE {
			return Err(DecodeError::InvalidValue);
		}

		let num_params = u8::decode(r)?;
		if num_params != 0 {
			return Err(DecodeError::InvalidValue);
		}

		Ok(Self {
			subscribe_id,
			track_alias,
			track_namespace,
			track_name,
			subscriber_priority,
		})
	}

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.subscribe_id.encode(w);
		self.track_alias.encode(w);
		encode_namespace(w, &self.track_namespace);
		self.track_name.encode(w);
		self.subscriber_priority.encode(w);
		GROUP_ORDER.encode(w);
		FILTER_TYPE.encode(w);
		0u8.encode(w); // no parameters
	}
}

/// SubscribeOk message (0x04)
#[derive(Clone, Debug)]
pub struct SubscribeOk {
	pub subscribe_id: u64,
	/// Largest group/object ID tuple
	pub largest: Option<(u64, u64)>,
}

impl Message for SubscribeOk {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.subscribe_id.encode(w);
		0u8.encode(w); // expires = 0
		GROUP_ORDER.encode(w);

		if let Some((group, object)) = self.largest {
			1u8.encode(w); // content exists
			group.encode(w);
			object.encode(w);
		} else {
			0u8.encode(w); // no content
		}

		0u8.encode(w); // no parameters
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let subscribe_id = u64::decode(r)?;

		let expires = u64::decode(r)?;
		if expires != 0 {
			return Err(DecodeError::InvalidValue);
		}

		let _group_order = u8::decode(r)?; // Don't care about group order

		let mut largest = None;
		let content_exists = u8::decode(r)?;
		if content_exists == 1 {
			let group = u64::decode(r)?;
			let object = u64::decode(r)?;
			largest = Some((group, object));
		} else if content_exists != 0 {
			return Err(DecodeError::InvalidValue);
		}

		let num_params = u8::decode(r)?;
		if num_params != 0 {
			return Err(DecodeError::InvalidValue);
		}

		Ok(Self { subscribe_id, largest })
	}
}

/// SubscribeError message (0x05)
#[derive(Clone, Debug)]
pub struct SubscribeError<'a> {
	pub subscribe_id: u64,
	pub error_code: u64,
	pub reason_phrase: Cow<'a, str>,
	pub track_alias: u64,
}

impl<'a> Message for SubscribeError<'a> {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.subscribe_id.encode(w);
		self.error_code.encode(w);
		self.reason_phrase.encode(w);
		self.track_alias.encode(w);
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let subscribe_id = u64::decode(r)?;
		let error_code = u64::decode(r)?;
		let reason_phrase = Cow::<str>::decode(r)?;
		let track_alias = u64::decode(r)?;

		Ok(Self {
			subscribe_id,
			error_code,
			reason_phrase,
			track_alias,
		})
	}
}

/// Unsubscribe message (0x0a)
#[derive(Clone, Debug)]
pub struct Unsubscribe {
	pub subscribe_id: u64,
}

impl Message for Unsubscribe {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.subscribe_id.encode(w);
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let subscribe_id = u64::decode(r)?;
		Ok(Self { subscribe_id })
	}
}

/// SubscribeDone message (0x0b)
#[derive(Clone, Debug)]
pub struct SubscribeDone<'a> {
	pub subscribe_id: u64,
	pub status_code: u64,
	pub reason_phrase: Cow<'a, str>,
	pub final_group_object: Option<(u64, u64)>,
}

impl<'a> Message for SubscribeDone<'a> {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.subscribe_id.encode(w);
		self.status_code.encode(w);
		self.reason_phrase.encode(w);

		if let Some((group, object)) = self.final_group_object {
			1u8.encode(w); // content exists
			group.encode(w);
			object.encode(w);
		} else {
			0u8.encode(w); // no content
		}
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let subscribe_id = u64::decode(r)?;
		let status_code = u64::decode(r)?;
		let reason_phrase = Cow::<str>::decode(r)?;

		let mut final_group_object = None;
		let content_exists = u64::decode(r)?;
		if content_exists == 1 {
			let group = u64::decode(r)?;
			let object = u64::decode(r)?;
			final_group_object = Some((group, object));
		} else if content_exists != 0 {
			return Err(DecodeError::InvalidValue);
		}

		Ok(Self {
			subscribe_id,
			status_code,
			reason_phrase,
			final_group_object,
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
			subscribe_id: 1,
			track_alias: 2,
			track_namespace: Path::new("test"),
			track_name: "video".into(),
			subscriber_priority: 128,
		};

		let encoded = encode_message(&msg);
		let decoded: Subscribe = decode_message(&encoded).unwrap();

		assert_eq!(decoded.subscribe_id, 1);
		assert_eq!(decoded.track_alias, 2);
		assert_eq!(decoded.track_namespace.as_str(), "test");
		assert_eq!(decoded.track_name, "video");
		assert_eq!(decoded.subscriber_priority, 128);
	}

	#[test]
	fn test_subscribe_nested_namespace() {
		let msg = Subscribe {
			subscribe_id: 100,
			track_alias: 200,
			track_namespace: Path::new("conference/room123"),
			track_name: "audio".into(),
			subscriber_priority: 255,
		};

		let encoded = encode_message(&msg);
		let decoded: Subscribe = decode_message(&encoded).unwrap();

		assert_eq!(decoded.track_namespace.as_str(), "conference/room123");
	}

	#[test]
	fn test_subscribe_ok_with_largest() {
		let msg = SubscribeOk {
			subscribe_id: 42,
			largest: Some((10, 20)),
		};

		let encoded = encode_message(&msg);
		let decoded: SubscribeOk = decode_message(&encoded).unwrap();

		assert_eq!(decoded.subscribe_id, 42);
		assert_eq!(decoded.largest, Some((10, 20)));
	}

	#[test]
	fn test_subscribe_ok_without_largest() {
		let msg = SubscribeOk {
			subscribe_id: 42,
			largest: None,
		};

		let encoded = encode_message(&msg);
		let decoded: SubscribeOk = decode_message(&encoded).unwrap();

		assert_eq!(decoded.subscribe_id, 42);
		assert_eq!(decoded.largest, None);
	}

	#[test]
	fn test_subscribe_error() {
		let msg = SubscribeError {
			subscribe_id: 123,
			error_code: 500,
			reason_phrase: "Not found".into(),
			track_alias: 456,
		};

		let encoded = encode_message(&msg);
		let decoded: SubscribeError = decode_message(&encoded).unwrap();

		assert_eq!(decoded.subscribe_id, 123);
		assert_eq!(decoded.error_code, 500);
		assert_eq!(decoded.reason_phrase, "Not found");
		assert_eq!(decoded.track_alias, 456);
	}

	#[test]
	fn test_unsubscribe() {
		let msg = Unsubscribe { subscribe_id: 999 };

		let encoded = encode_message(&msg);
		let decoded: Unsubscribe = decode_message(&encoded).unwrap();

		assert_eq!(decoded.subscribe_id, 999);
	}

	#[test]
	fn test_subscribe_done_with_final() {
		let msg = SubscribeDone {
			subscribe_id: 10,
			status_code: 0,
			reason_phrase: "complete".into(),
			final_group_object: Some((5, 10)),
		};

		let encoded = encode_message(&msg);
		let decoded: SubscribeDone = decode_message(&encoded).unwrap();

		assert_eq!(decoded.subscribe_id, 10);
		assert_eq!(decoded.status_code, 0);
		assert_eq!(decoded.reason_phrase, "complete");
		assert_eq!(decoded.final_group_object, Some((5, 10)));
	}

	#[test]
	fn test_subscribe_done_without_final() {
		let msg = SubscribeDone {
			subscribe_id: 10,
			status_code: 1,
			reason_phrase: "error".into(),
			final_group_object: None,
		};

		let encoded = encode_message(&msg);
		let decoded: SubscribeDone = decode_message(&encoded).unwrap();

		assert_eq!(decoded.final_group_object, None);
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
