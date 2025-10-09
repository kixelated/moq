//! IETF moq-transport-07 subscribe messages

use std::borrow::Cow;

use crate::{coding::*, Path};

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
		}

		Ok(Self {
			subscribe_id,
			status_code,
			reason_phrase,
			final_group_object,
		})
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
