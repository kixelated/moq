//! IETF moq-transport-07 announce messages

use std::borrow::Cow;

use crate::{coding::*, Path};

use super::util::{decode_namespace, encode_namespace};

/// Announce message (0x06)
/// Sent by the publisher to announce the availability of a namespace.
#[derive(Clone, Debug)]
pub struct Announce<'a> {
	pub track_namespace: Path<'a>,
}

impl<'a> Message for Announce<'a> {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let track_namespace = decode_namespace(r)?;

		let num_params = u8::decode(r)?;
		if num_params > 0 {
			return Err(DecodeError::InvalidValue);
		}

		Ok(Self { track_namespace })
	}

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		encode_namespace(w, &self.track_namespace);
		0u8.encode(w); // number of parameters
	}
}

/// AnnounceOk message (0x07)
#[derive(Clone, Debug)]
pub struct AnnounceOk<'a> {
	pub track_namespace: Path<'a>,
}

impl<'a> Message for AnnounceOk<'a> {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		encode_namespace(w, &self.track_namespace);
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let track_namespace = decode_namespace(r)?;
		Ok(Self { track_namespace })
	}
}

/// AnnounceError message (0x08)
#[derive(Clone, Debug)]
pub struct AnnounceError<'a> {
	pub track_namespace: Path<'a>,
	pub error_code: u64,
	pub reason_phrase: Cow<'a, str>,
}

impl<'a> Message for AnnounceError<'a> {
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

/// Unannounce message (0x09)
#[derive(Clone, Debug)]
pub struct Unannounce<'a> {
	pub track_namespace: Path<'a>,
}

impl<'a> Message for Unannounce<'a> {
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
pub struct AnnounceCancel<'a> {
	pub track_namespace: Path<'a>,
	pub error_code: u64,
	pub reason_phrase: Cow<'a, str>,
}

impl<'a> Message for AnnounceCancel<'a> {
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
		let msg = Announce {
			track_namespace: Path::new("test/broadcast"),
		};

		let encoded = encode_message(&msg);
		let decoded: Announce = decode_message(&encoded).unwrap();

		assert_eq!(decoded.track_namespace.as_str(), "test/broadcast");
	}

	#[test]
	fn test_announce_ok() {
		let msg = AnnounceOk {
			track_namespace: Path::new("foo"),
		};

		let encoded = encode_message(&msg);
		let decoded: AnnounceOk = decode_message(&encoded).unwrap();

		assert_eq!(decoded.track_namespace.as_str(), "foo");
	}

	#[test]
	fn test_announce_error() {
		let msg = AnnounceError {
			track_namespace: Path::new("test"),
			error_code: 404,
			reason_phrase: "Unauthorized".into(),
		};

		let encoded = encode_message(&msg);
		let decoded: AnnounceError = decode_message(&encoded).unwrap();

		assert_eq!(decoded.track_namespace.as_str(), "test");
		assert_eq!(decoded.error_code, 404);
		assert_eq!(decoded.reason_phrase, "Unauthorized");
	}

	#[test]
	fn test_unannounce() {
		let msg = Unannounce {
			track_namespace: Path::new("old/stream"),
		};

		let encoded = encode_message(&msg);
		let decoded: Unannounce = decode_message(&encoded).unwrap();

		assert_eq!(decoded.track_namespace.as_str(), "old/stream");
	}

	#[test]
	fn test_announce_cancel() {
		let msg = AnnounceCancel {
			track_namespace: Path::new("canceled"),
			error_code: 1,
			reason_phrase: "Shutdown".into(),
		};

		let encoded = encode_message(&msg);
		let decoded: AnnounceCancel = decode_message(&encoded).unwrap();

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

		let result: Result<Announce, _> = decode_message(&invalid_bytes);
		assert!(result.is_err());
	}
}
