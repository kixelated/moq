//! IETF moq-transport-07 track status messages

use std::borrow::Cow;

use crate::{coding::*, Path};

/// TrackStatusRequest message (0x0d)
#[derive(Clone, Debug)]
pub struct TrackStatusRequest<'a> {
	pub track_namespace: Path<'a>,
	pub track_name: Cow<'a, str>,
}

impl<'a> Message for TrackStatusRequest<'a> {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		encode_namespace(w, &self.track_namespace);
		self.track_name.encode(w);
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let track_namespace = decode_namespace(r)?;
		let track_name = Cow::<str>::decode(r)?;

		Ok(Self {
			track_namespace,
			track_name,
		})
	}
}

/// TrackStatus message (0x0e)
/// Sent to communicate track-level state
#[derive(Clone, Debug)]
pub struct TrackStatus<'a> {
	pub track_namespace: Path<'a>,
	pub track_name: Cow<'a, str>,
	pub status_code: u64,
	pub last_group_id: u64,
	pub last_object_id: u64,
}

impl<'a> TrackStatus<'a> {
	pub const STATUS_IN_PROGRESS: u64 = 0x00;
	pub const STATUS_NOT_FOUND: u64 = 0x01;
	pub const STATUS_NOT_AUTHORIZED: u64 = 0x02;
	pub const STATUS_ENDED: u64 = 0x03;
}

impl<'a> Message for TrackStatus<'a> {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		encode_namespace(w, &self.track_namespace);
		self.track_name.encode(w);
		self.status_code.encode(w);
		self.last_group_id.encode(w);
		self.last_object_id.encode(w);
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let track_namespace = decode_namespace(r)?;
		let track_name = Cow::<str>::decode(r)?;
		let status_code = u64::decode(r)?;
		let last_group_id = u64::decode(r)?;
		let last_object_id = u64::decode(r)?;

		Ok(Self {
			track_namespace,
			track_name,
			status_code,
			last_group_id,
			last_object_id,
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
