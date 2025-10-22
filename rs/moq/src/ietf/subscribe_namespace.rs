//! IETF moq-transport-07 subscribe announces messages

use std::borrow::Cow;

use crate::{coding::*, ietf::Message, Path};

use super::namespace::{decode_namespace, encode_namespace};

/// SubscribeAnnounces message (0x11)
#[derive(Clone, Debug)]
pub struct SubscribeNamespace<'a> {
	pub namespace: Path<'a>,
	pub request_id: u64,
}

impl<'a> Message for SubscribeNamespace<'a> {
	const ID: u64 = 0x11;

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		encode_namespace(w, &self.namespace);
		self.request_id.encode(w);
		0u8.encode(w); // no parameters
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let namespace = decode_namespace(r)?;
		let request_id = u64::decode(r)?;

		let num_params = u8::decode(r)?;
		if num_params != 0 {
			return Err(DecodeError::Unsupported);
		}

		Ok(Self { namespace, request_id })
	}
}

/// SubscribeNamespaceOk message (0x12)
#[derive(Clone, Debug)]
pub struct SubscribeNamespaceOk {
	pub request_id: u64,
}

impl Message for SubscribeNamespaceOk {
	const ID: u64 = 0x12;

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.request_id.encode(w);
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let request_id = u64::decode(r)?;
		Ok(Self { request_id })
	}
}
/// SubscribeNamespaceError message (0x13)
#[derive(Clone, Debug)]
pub struct SubscribeNamespaceError<'a> {
	pub request_id: u64,
	pub error_code: u64,
	pub reason_phrase: Cow<'a, str>,
}

impl<'a> Message for SubscribeNamespaceError<'a> {
	const ID: u64 = 0x13;

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

/// UnsubscribeAnnounces message (0x14)
#[derive(Clone, Debug)]
pub struct UnsubscribeNamespace {
	pub request_id: u64,
}

impl Message for UnsubscribeNamespace {
	const ID: u64 = 0x14;

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.request_id.encode(w);
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let request_id = u64::decode(r)?;
		Ok(Self { request_id })
	}
}
