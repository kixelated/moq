//! IETF moq-transport-07 subscribe announces messages

use std::borrow::Cow;

use crate::{coding::*, Path};

/// SubscribeAnnounces message (0x11)
#[derive(Clone, Debug)]
pub struct SubscribeAnnounces<'a> {
	pub namespace: Path<'a>,
}

impl<'a> Message for SubscribeAnnounces<'a> {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		encode_namespace(w, &self.namespace);
		0u8.encode(w); // no parameters
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let namespace = decode_namespace(r)?;

		let num_params = u8::decode(r)?;
		if num_params != 0 {
			return Err(DecodeError::InvalidValue);
		}

		Ok(Self { namespace })
	}
}

/// SubscribeAnnouncesOk message (0x12)
#[derive(Clone, Debug)]
pub struct SubscribeAnnouncesOk<'a> {
	pub namespace: Path<'a>,
}

impl<'a> Message for SubscribeAnnouncesOk<'a> {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		encode_namespace(w, &self.namespace);
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let namespace = decode_namespace(r)?;
		Ok(Self { namespace })
	}
}

/// SubscribeAnnouncesError message (0x13)
#[derive(Clone, Debug)]
pub struct SubscribeAnnouncesError<'a> {
	pub namespace: Path<'a>,
	pub error_code: u64,
	pub reason_phrase: Cow<'a, str>,
}

impl<'a> Message for SubscribeAnnouncesError<'a> {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		encode_namespace(w, &self.namespace);
		self.error_code.encode(w);
		self.reason_phrase.encode(w);
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let namespace = decode_namespace(r)?;
		let error_code = u64::decode(r)?;
		let reason_phrase = Cow::<str>::decode(r)?;

		Ok(Self {
			namespace,
			error_code,
			reason_phrase,
		})
	}
}

/// UnsubscribeAnnounces message (0x14)
#[derive(Clone, Debug)]
pub struct UnsubscribeAnnounces<'a> {
	pub namespace: Path<'a>,
}

impl<'a> Message for UnsubscribeAnnounces<'a> {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		encode_namespace(w, &self.namespace);
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let namespace = decode_namespace(r)?;
		Ok(Self { namespace })
	}
}

/// Helper function to encode namespace as tuple of strings
fn encode_namespace<W: bytes::BufMut>(w: &mut W, namespace: &Path) {
	// Split the path by '/' to get individual parts
	let path_str = namespace.as_str();
	if path_str.is_empty() {
		0u64.encode(w);
	} else {
		let parts: Vec<&str> = path_str.split('/').collect();
		(parts.len() as u64).encode(w);
		for part in parts {
			part.encode(w);
		}
	}
}

/// Helper function to decode namespace from tuple of strings
fn decode_namespace<R: bytes::Buf>(r: &mut R) -> Result<Path<'static>, DecodeError> {
	let count = u64::decode(r)? as usize;

	if count == 0 {
		return Ok(Path::from(String::new()));
	}

	let mut parts = Vec::with_capacity(count.min(16));
	for _ in 0..count {
		let part = String::decode(r)?;
		parts.push(part);
	}

	Ok(Path::from(parts.join("/")))
}
