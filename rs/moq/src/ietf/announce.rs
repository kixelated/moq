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
