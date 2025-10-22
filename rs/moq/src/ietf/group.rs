use crate::coding::{Decode, DecodeError, Encode};

const SUBGROUP_ID: u8 = 0x0;

pub struct Group {
	pub request_id: u64,
	pub group_id: u64,

	// Each object has extensions.
	pub has_extensions: bool,

	// There's an explicit subgroup on the wire.
	pub has_subgroup: bool,

	// Use the first object ID as the subgroup ID
	// Since we don't support subgroups or object ID > 0, this is trivial to support.
	// Not compatibile with has_subgroup
	pub has_subgroup_object: bool,

	// There's an implicit end marker when the stream is closed.
	pub has_end: bool,
}

impl Encode for Group {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		assert!(
			!self.has_subgroup || !self.has_subgroup_object,
			"has_subgroup and has_subgroup_object cannot be true at the same time"
		);

		let mut id: u8 = 0x10; // Base value
		if self.has_extensions {
			id |= 0x01;
		}
		if self.has_subgroup {
			id |= 0x02;
		}
		if self.has_subgroup_object {
			id |= 0x04;
		}
		if self.has_end {
			id |= 0x08;
		}
		id.encode(w);

		self.request_id.encode(w);
		self.group_id.encode(w);

		if self.has_subgroup {
			SUBGROUP_ID.encode(w);
		}

		// Publisher priority
		0u8.encode(w);
	}
}

impl Decode for Group {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let id = u64::decode(r)?;
		if !(0x10..=0x1D).contains(&id) {
			return Err(DecodeError::InvalidValue);
		}

		let has_extensions = (id & 0x01) != 0;
		let has_subgroup = (id & 0x02) != 0;
		let has_subgroup_object = (id & 0x04) != 0;
		let has_end = (id & 0x08) != 0;

		if has_subgroup && has_subgroup_object {
			return Err(DecodeError::InvalidValue);
		}

		let request_id = u64::decode(r)?;
		let group_id = u64::decode(r)?;

		if has_subgroup {
			let subgroup_id = u8::decode(r)?;
			if subgroup_id != SUBGROUP_ID {
				return Err(DecodeError::Unsupported);
			}
		}

		let _publisher_priority = u8::decode(r)?;

		Ok(Self {
			request_id,
			group_id,
			has_extensions,
			has_subgroup,
			has_subgroup_object,
			has_end,
		})
	}
}

/* We use an optimized streaming version to avoid buffering the entire frame.
pub struct Object {
	// If None, this is the end of the group.
	pub payload: Option<Vec<u8>>,
}

impl Encode for Object {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		0u8.encode(w); // id_delta == 0

		let size = self.payload.as_ref().map(|p| p.len()).unwrap_or(0);
		size.encode(w);

		match &self.payload {
			Some(payload) if !payload.is_empty() => w.put_slice(payload),
			Some(_) => 0u8.encode(w),
			None => GROUP_END.encode(w),
		}
	}
}

impl Decode for Object {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let id_delta = u64::decode(r)?;
		if id_delta != 0 {
			return Err(DecodeError::Unsupported);
		}

		let size = u64::decode(r)?;

		if r.remaining() < size as usize {
			return Err(DecodeError::Short);
		}

		if size > 0 {
			let payload = r.copy_to_bytes(size as usize).to_vec();
			Ok(Self { payload: Some(payload) })
		} else {
			match u8::decode(r)? {
				0 => Ok(Self {
					payload: Some(Vec::new()),
				}),
				GROUP_END => Ok(Self { payload: None }),
				_ => Err(DecodeError::InvalidValue),
			}
		}
	}
}

// The same as Object, but when extensions have been negotiated.
// They're always ignored of course.
pub struct ObjectExtensions {
	// If None, this is the end of the group.
	pub payload: Option<Vec<u8>>,
}

impl Encode for ObjectExtensions {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		0u8.encode(w); // id_delta == 0

		// zero length extensions
		0u8.encode(w);

		let size = self.payload.as_ref().map(|p| p.len()).unwrap_or(0);
		size.encode(w);

		match &self.payload {
			Some(payload) if !payload.is_empty() => w.put_slice(payload),
			Some(_) => 0u8.encode(w),
			None => GROUP_END.encode(w),
		}
	}
}

impl Decode for ObjectExtensions {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let id_delta = u64::decode(r)?;
		if id_delta != 0 {
			return Err(DecodeError::Unsupported);
		}

		let size = u64::decode(r)?;
		if r.remaining() < size as usize {
			return Err(DecodeError::Short);
		}

		// Skip the extensions
		r.advance(size as usize);

		let size = u64::decode(r)?;
		if r.remaining() < size as usize {
			return Err(DecodeError::Short);
		}

		if size > 0 {
			let payload = r.copy_to_bytes(size as usize).to_vec();
			Ok(Self { payload: Some(payload) })
		} else {
			match u8::decode(r)? {
				0 => Ok(Self {
					payload: Some(Vec::new()),
				}),
				GROUP_END => Ok(Self { payload: None }),
				_ => Err(DecodeError::InvalidValue),
			}
		}
	}
}

*/
