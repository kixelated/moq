use crate::coding::{Decode, DecodeError, Encode};

use num_enum::{IntoPrimitive, TryFromPrimitive};
const SUBGROUP_ID: u8 = 0x0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, TryFromPrimitive, IntoPrimitive)]
#[repr(u8)]
pub enum GroupOrder {
	Ascending = 0x1,
	Descending = 0x2,
}

impl Encode for GroupOrder {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		u8::from(*self).encode(w);
	}
}

impl Decode for GroupOrder {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		Self::try_from(u8::decode(r)?).map_err(|_| DecodeError::InvalidValue)
	}
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupFlags {
	// The group has extensions.
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

impl GroupFlags {
	pub const START: u64 = 0x10;
	pub const END: u64 = 0x1d;

	pub fn encode(&self) -> u64 {
		assert!(
			!self.has_subgroup || !self.has_subgroup_object,
			"has_subgroup and has_subgroup_object cannot be true at the same time"
		);

		let mut id: u64 = Self::START; // Base value
		if self.has_extensions {
			id |= 0x01;
		}
		if self.has_subgroup_object {
			id |= 0x02;
		}
		if self.has_subgroup {
			id |= 0x04;
		}
		if self.has_end {
			id |= 0x08;
		}
		id
	}

	pub fn decode(id: u64) -> Result<Self, DecodeError> {
		if !(Self::START..=Self::END).contains(&id) {
			return Err(DecodeError::InvalidValue);
		}

		let has_extensions = (id & 0x01) != 0;
		let has_subgroup_object = (id & 0x02) != 0;
		let has_subgroup = (id & 0x04) != 0;
		let has_end = (id & 0x08) != 0;

		if has_subgroup && has_subgroup_object {
			return Err(DecodeError::InvalidValue);
		}

		Ok(Self {
			has_extensions,
			has_subgroup,
			has_subgroup_object,
			has_end,
		})
	}
}

impl Default for GroupFlags {
	fn default() -> Self {
		Self {
			has_extensions: false,
			has_subgroup: false,
			has_subgroup_object: false,
			has_end: true,
		}
	}
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupHeader {
	pub track_alias: u64,
	pub group_id: u64,
	pub flags: GroupFlags,
}

impl Encode for GroupHeader {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.flags.encode().encode(w);
		self.track_alias.encode(w);
		self.group_id.encode(w);

		if self.flags.has_subgroup {
			SUBGROUP_ID.encode(w);
		}

		// Publisher priority
		0u8.encode(w);
	}
}

impl Decode for GroupHeader {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let flags = GroupFlags::decode(u64::decode(r)?)?;
		let track_alias = u64::decode(r)?;
		let group_id = u64::decode(r)?;

		if flags.has_subgroup {
			let subgroup_id = u8::decode(r)?;
			if subgroup_id != SUBGROUP_ID {
				return Err(DecodeError::Unsupported);
			}
		}

		let _publisher_priority = u8::decode(r)?;

		Ok(Self {
			track_alias,
			group_id,
			flags,
		})
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	// Test table from draft-ietf-moq-transport-14 Section 10.4.2 Table 7
	#[test]
	fn test_group_flags_spec_table() {
		// Type 0x10: No subgroup field, Subgroup ID = 0, No extensions, No end
		let flags = GroupFlags::decode(0x10).unwrap();
		assert!(!flags.has_subgroup);
		assert!(!flags.has_subgroup_object);
		assert!(!flags.has_extensions);
		assert!(!flags.has_end);
		assert_eq!(flags.encode(), 0x10);

		// Type 0x11: No subgroup field, Subgroup ID = 0, Extensions, No end
		let flags = GroupFlags::decode(0x11).unwrap();
		assert!(!flags.has_subgroup);
		assert!(!flags.has_subgroup_object);
		assert!(flags.has_extensions);
		assert!(!flags.has_end);
		assert_eq!(flags.encode(), 0x11);

		// Type 0x12: No subgroup field, Subgroup ID = First Object ID, No extensions, No end
		let flags = GroupFlags::decode(0x12).unwrap();
		assert!(!flags.has_subgroup);
		assert!(flags.has_subgroup_object);
		assert!(!flags.has_extensions);
		assert!(!flags.has_end);
		assert_eq!(flags.encode(), 0x12);

		// Type 0x13: No subgroup field, Subgroup ID = First Object ID, Extensions, No end
		let flags = GroupFlags::decode(0x13).unwrap();
		assert!(!flags.has_subgroup);
		assert!(flags.has_subgroup_object);
		assert!(flags.has_extensions);
		assert!(!flags.has_end);
		assert_eq!(flags.encode(), 0x13);

		// Type 0x14: Subgroup field present, No extensions, No end
		let flags = GroupFlags::decode(0x14).unwrap();
		assert!(flags.has_subgroup);
		assert!(!flags.has_subgroup_object);
		assert!(!flags.has_extensions);
		assert!(!flags.has_end);
		assert_eq!(flags.encode(), 0x14);

		// Type 0x15: Subgroup field present, Extensions, No end
		let flags = GroupFlags::decode(0x15).unwrap();
		assert!(flags.has_subgroup);
		assert!(!flags.has_subgroup_object);
		assert!(flags.has_extensions);
		assert!(!flags.has_end);
		assert_eq!(flags.encode(), 0x15);

		// Type 0x18: No subgroup field, Subgroup ID = 0, No extensions, End of group
		let flags = GroupFlags::decode(0x18).unwrap();
		assert!(!flags.has_subgroup);
		assert!(!flags.has_subgroup_object);
		assert!(!flags.has_extensions);
		assert!(flags.has_end);
		assert_eq!(flags.encode(), 0x18);

		// Type 0x19: No subgroup field, Subgroup ID = 0, Extensions, End of group
		let flags = GroupFlags::decode(0x19).unwrap();
		assert!(!flags.has_subgroup);
		assert!(!flags.has_subgroup_object);
		assert!(flags.has_extensions);
		assert!(flags.has_end);
		assert_eq!(flags.encode(), 0x19);

		// Type 0x1A: No subgroup field, Subgroup ID = First Object ID, No extensions, End of group
		let flags = GroupFlags::decode(0x1A).unwrap();
		assert!(!flags.has_subgroup);
		assert!(flags.has_subgroup_object);
		assert!(!flags.has_extensions);
		assert!(flags.has_end);
		assert_eq!(flags.encode(), 0x1A);

		// Type 0x1B: No subgroup field, Subgroup ID = First Object ID, Extensions, End of group
		let flags = GroupFlags::decode(0x1B).unwrap();
		assert!(!flags.has_subgroup);
		assert!(flags.has_subgroup_object);
		assert!(flags.has_extensions);
		assert!(flags.has_end);
		assert_eq!(flags.encode(), 0x1B);

		// Type 0x1C: Subgroup field present, No extensions, End of group
		let flags = GroupFlags::decode(0x1C).unwrap();
		assert!(flags.has_subgroup);
		assert!(!flags.has_subgroup_object);
		assert!(!flags.has_extensions);
		assert!(flags.has_end);
		assert_eq!(flags.encode(), 0x1C);

		// Type 0x1D: Subgroup field present, Extensions, End of group
		let flags = GroupFlags::decode(0x1D).unwrap();
		assert!(flags.has_subgroup);
		assert!(!flags.has_subgroup_object);
		assert!(flags.has_extensions);
		assert!(flags.has_end);
		assert_eq!(flags.encode(), 0x1D);

		// Invalid: Both has_subgroup and has_subgroup_object (would be 0x16)
		assert!(GroupFlags::decode(0x16).is_err());
	}
}
