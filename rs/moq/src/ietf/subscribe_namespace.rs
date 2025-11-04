//! IETF moq-transport-14 subscribe namespace messages

use std::borrow::Cow;

use crate::{
	coding::*,
	ietf::{Message, Parameters, RequestId},
	Path,
};

use super::namespace::{decode_namespace, encode_namespace};

/// SubscribeNamespace message (0x11)
#[derive(Clone, Debug)]
pub struct SubscribeNamespace<'a> {
	pub request_id: RequestId,
	pub namespace: Path<'a>,
}

impl<'a> Message for SubscribeNamespace<'a> {
	const ID: u64 = 0x11;

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.request_id.encode(w);
		encode_namespace(w, &self.namespace);
		0u8.encode(w); // no parameters
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let request_id = RequestId::decode(r)?;
		let namespace = decode_namespace(r)?;

		// Ignore parameters, who cares.
		let _params = Parameters::decode(r)?;

		Ok(Self { namespace, request_id })
	}
}

/// SubscribeNamespaceOk message (0x12)
#[derive(Clone, Debug)]
pub struct SubscribeNamespaceOk {
	pub request_id: RequestId,
}

impl Message for SubscribeNamespaceOk {
	const ID: u64 = 0x12;

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.request_id.encode(w);
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let request_id = RequestId::decode(r)?;
		Ok(Self { request_id })
	}
}
/// SubscribeNamespaceError message (0x13)
#[derive(Clone, Debug)]
pub struct SubscribeNamespaceError<'a> {
	pub request_id: RequestId,
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
		let request_id = RequestId::decode(r)?;
		let error_code = u64::decode(r)?;
		let reason_phrase = Cow::<str>::decode(r)?;

		Ok(Self {
			request_id,
			error_code,
			reason_phrase,
		})
	}
}

/// UnsubscribeNamespace message (0x14)
#[derive(Clone, Debug)]
pub struct UnsubscribeNamespace {
	pub request_id: RequestId,
}

impl Message for UnsubscribeNamespace {
	const ID: u64 = 0x14;

	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.request_id.encode(w);
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let request_id = RequestId::decode(r)?;
		Ok(Self { request_id })
	}
}
