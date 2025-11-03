use std::collections::{hash_map, HashMap};

use num_enum::{FromPrimitive, IntoPrimitive};

use crate::coding::*;

const MAX_PARAMS: u64 = 64;

#[derive(Debug, Copy, Clone, FromPrimitive, IntoPrimitive, Eq, Hash, PartialEq)]
#[repr(u64)]
pub enum ParameterVarInt {
	MaxRequestId = 2,
	MaxAuthTokenCacheSize = 4,
	#[num_enum(catch_all)]
	Unknown(u64),
}

#[derive(Debug, Copy, Clone, FromPrimitive, IntoPrimitive, Eq, Hash, PartialEq)]
#[repr(u64)]
pub enum ParameterBytes {
	Path = 1,
	AuthorizationToken = 3,
	Authority = 5,
	Implementation = 7,
	#[num_enum(catch_all)]
	Unknown(u64),
}

#[derive(Default, Debug, Clone)]
pub struct Parameters {
	vars: HashMap<ParameterVarInt, u64>,
	bytes: HashMap<ParameterBytes, Vec<u8>>,
}

impl Decode for Parameters {
	fn decode<R: bytes::Buf>(mut r: &mut R) -> Result<Self, DecodeError> {
		let mut vars = HashMap::new();
		let mut bytes = HashMap::new();

		// I hate this encoding so much; let me encode my role and get on with my life.
		let count = u64::decode(r)?;

		if count > MAX_PARAMS {
			return Err(DecodeError::TooMany);
		}

		for _ in 0..count {
			let kind = u64::decode(r)?;

			if kind % 2 == 0 {
				let kind = ParameterVarInt::from(kind);
				match vars.entry(kind) {
					hash_map::Entry::Occupied(_) => return Err(DecodeError::Duplicate),
					hash_map::Entry::Vacant(entry) => entry.insert(u64::decode(&mut r)?),
				};
			} else {
				let kind = ParameterBytes::from(kind);
				match bytes.entry(kind) {
					hash_map::Entry::Occupied(_) => return Err(DecodeError::Duplicate),
					hash_map::Entry::Vacant(entry) => entry.insert(Vec::<u8>::decode(&mut r)?),
				};
			}
		}

		Ok(Parameters { vars, bytes })
	}
}

impl Encode for Parameters {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		(self.vars.len() + self.bytes.len()).encode(w);

		for (kind, value) in self.vars.iter() {
			u64::from(*kind).encode(w);
			value.encode(w);
		}

		for (kind, value) in self.bytes.iter() {
			u64::from(*kind).encode(w);
			value.encode(w);
		}
	}
}

impl Parameters {
	pub fn get_varint(&self, kind: ParameterVarInt) -> Option<u64> {
		self.vars.get(&kind).copied()
	}

	pub fn set_varint(&mut self, kind: ParameterVarInt, value: u64) {
		self.vars.insert(kind, value);
	}

	pub fn get_bytes(&self, kind: ParameterBytes) -> Option<&[u8]> {
		self.bytes.get(&kind).map(|v| v.as_slice())
	}

	pub fn set_bytes(&mut self, kind: ParameterBytes, value: Vec<u8>) {
		self.bytes.insert(kind, value);
	}
}
