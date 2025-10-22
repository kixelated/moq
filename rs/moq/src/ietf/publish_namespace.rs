//! IETF moq-transport-07 announce messages

use std::borrow::Cow;

use crate::{coding::*, ietf::Message, Path};

use super::namespace::{decode_namespace, encode_namespace};

/// Announce message (0x06)
/// Sent by the publisher to announce the availability of a namespace.
#[derive(Clone, Debug)]
pub struct PublishNamespace<'a> {
	pub request_id: u64,
	pub track_namespace: Path<'a>,
}

impl<'a> Message for PublishNamespace<'a> {
	const ID: u64 = 0x06;

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.request_id.encode(w);
		encode_namespace(w, &self.track_namespace);
		0u8.encode(w); // number of parameters
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let request_id = u64::decode(r)?;
		let track_namespace = decode_namespace(r)?;

		let num_params = u8::decode(r)?;
		if num_params != 0 {
			return Err(DecodeError::Unsupported);
		}

		Ok(Self {
			request_id,
			track_namespace,
		})
	}
}

/// AnnounceOk message (0x07)
#[derive(Clone, Debug)]
pub struct PublishNamespaceOk {
	pub request_id: u64,
}

impl Message for PublishNamespaceOk {
	const ID: u64 = 0x07;

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.request_id.encode(w);
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let request_id = u64::decode(r)?;
		Ok(Self { request_id })
	}
}

/// AnnounceError message (0x08)
#[derive(Clone, Debug)]
pub struct PublishNamespaceError<'a> {
	pub request_id: u64,
	pub error_code: u64,
	pub reason_phrase: Cow<'a, str>,
}

impl<'a> Message for PublishNamespaceError<'a> {
	const ID: u64 = 0x08;

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
/// Unannounce message (0x09)
#[derive(Clone, Debug)]
pub struct PublishNamespaceDone<'a> {
	pub track_namespace: Path<'a>,
}

impl<'a> Message for PublishNamespaceDone<'a> {
	const ID: u64 = 0x09;

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		encode_namespace(w, &self.track_namespace);
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let track_namespace = decode_namespace(r)?;
		Ok(Self { track_namespace })
	}
}

/// AnnounceCancel message (0x0c)
#[derive(Clone, Debug)]
pub struct PublishNamespaceCancel<'a> {
	pub track_namespace: Path<'a>,
	pub error_code: u64,
	pub reason_phrase: Cow<'a, str>,
}

impl<'a> Message for PublishNamespaceCancel<'a> {
	const ID: u64 = 0x0c;

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		encode_namespace(w, &self.track_namespace);
		self.error_code.encode(w);
		self.reason_phrase.encode(w);
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let track_namespace = decode_namespace(r)?;
		let error_code = u64::decode(r)?;
		let reason_phrase = Cow::<str>::decode(r)?;
		Ok(Self {
			track_namespace,
			error_code,
			reason_phrase,
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
	fn test_announce_round_trip() {
		let msg = PublishNamespace {
			request_id: 1,
			track_namespace: Path::new("test/broadcast"),
		};

		let encoded = encode_message(&msg);
		let decoded: PublishNamespace = decode_message(&encoded).unwrap();

		assert_eq!(decoded.track_namespace.as_str(), "test/broadcast");
	}

	#[test]
	fn test_announce_error() {
		let msg = PublishNamespaceError {
			request_id: 1,
			error_code: 404,
			reason_phrase: "Unauthorized".into(),
		};

		let encoded = encode_message(&msg);
		let decoded: PublishNamespaceError = decode_message(&encoded).unwrap();

		assert_eq!(decoded.error_code, 404);
		assert_eq!(decoded.reason_phrase, "Unauthorized");
	}

	#[test]
	fn test_unannounce() {
		let msg = PublishNamespaceDone {
			track_namespace: Path::new("old/stream"),
		};

		let encoded = encode_message(&msg);
		let decoded: PublishNamespaceDone = decode_message(&encoded).unwrap();

		assert_eq!(decoded.track_namespace.as_str(), "old/stream");
	}

	#[test]
	fn test_announce_cancel() {
		let msg = PublishNamespaceCancel {
			track_namespace: Path::new("canceled"),
			error_code: 1,
			reason_phrase: "Shutdown".into(),
		};

		let encoded = encode_message(&msg);
		let decoded: PublishNamespaceCancel = decode_message(&encoded).unwrap();

		assert_eq!(decoded.track_namespace.as_str(), "canceled");
		assert_eq!(decoded.error_code, 1);
		assert_eq!(decoded.reason_phrase, "Shutdown");
	}

	#[test]
	fn test_announce_rejects_parameters() {
		#[rustfmt::skip]
		let invalid_bytes = vec![
			0x01, // namespace length
			0x04, 0x74, 0x65, 0x73, 0x74, // "test"
			0x01, // INVALID: num_params = 1
		];

		let result: Result<PublishNamespace, _> = decode_message(&invalid_bytes);
		assert!(result.is_err());
	}
}
