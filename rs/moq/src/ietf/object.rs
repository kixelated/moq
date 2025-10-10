use bytes::Buf;

use crate::coding::{Decode, DecodeError, Encode};

const SUBGROUP_ID: u8 = 0x0;
const GROUP_END: u8 = 0x03;

pub struct Group {
	pub subscribe_id: u64,
	pub track_alias: u64,
	pub group_id: u64,
	pub publisher_priority: u8,
}

impl Group {
	pub const STREAM_TYPE: u64 = 0x04;
}

impl Encode for Group {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.subscribe_id.encode(w);
		self.track_alias.encode(w);
		self.group_id.encode(w);
		SUBGROUP_ID.encode(w);
		self.publisher_priority.encode(w);
	}
}

impl Decode for Group {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let subscribe_id = u64::decode(r)?;
		let track_alias = u64::decode(r)?;
		let group_id = u64::decode(r)?;
		let subgroup_id = u8::decode(r)?;
		if subgroup_id != SUBGROUP_ID {
			return Err(DecodeError::InvalidValue);
		}
		let publisher_priority = u8::decode(r)?;
		Ok(Self {
			subscribe_id,
			track_alias,
			group_id,
			publisher_priority,
		})
	}
}

pub struct Frame {
	pub id: u64,
	pub payload: Option<Vec<u8>>,
}

impl Encode for Frame {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.id.encode(w);

		let size = self.payload.as_ref().map(|p| p.len()).unwrap_or(0);
		size.encode(w);

		match &self.payload {
			Some(payload) if !payload.is_empty() => w.put_slice(payload),
			Some(_) => 0u8.encode(w),
			None => GROUP_END.encode(w),
		}
	}
}

impl Decode for Frame {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let id = u64::decode(r)?;
		let size = u64::decode(r)?;

		if r.remaining() < size as usize {
			return Err(DecodeError::Short);
		}

		if size > 0 {
			let payload = r.copy_to_bytes(size as usize).to_vec();
			Ok(Self {
				id,
				payload: Some(payload),
			})
		} else {
			match u8::decode(r)? {
				0 => Ok(Self {
					id,
					payload: Some(Vec::new()),
				}),
				GROUP_END => Ok(Self { id, payload: None }),
				_ => Err(DecodeError::InvalidValue),
			}
		}
	}
}
