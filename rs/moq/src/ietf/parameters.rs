use std::collections::HashMap;

use crate::coding::*;

const MAX_PARAMS: u64 = 64;

#[derive(Default, Debug, Clone)]
pub struct Parameters(HashMap<u64, Vec<u8>>);

impl Decode for Parameters {
	fn decode<R: bytes::Buf>(mut r: &mut R) -> Result<Self, DecodeError> {
		let mut map = HashMap::new();

		// I hate this encoding so much; let me encode my role and get on with my life.
		let count = u64::decode(r)?;

		if count > MAX_PARAMS {
			return Err(DecodeError::TooMany);
		}

		for _ in 0..count {
			let kind = u64::decode(r)?;

			if map.contains_key(&kind) {
				return Err(DecodeError::Duplicate);
			}

			// Per draft-ietf-moq-transport-14 Section 1.4.2:
			// - If Type is even, Value is a single varint (no length prefix)
			// - If Type is odd, Value has a length prefix followed by bytes
			let data = if kind % 2 == 0 {
				// Even: decode as varint and encode it as bytes
				let value = u64::decode(&mut r)?;
				// Store the varint as bytes (we'll need to encode it back when accessing)
				let mut bytes = Vec::new();
				value.encode(&mut bytes);
				bytes
			} else {
				// Odd: decode as length-prefixed bytes
				Vec::<u8>::decode(&mut r)?
			};

			map.insert(kind, data);
		}

		Ok(Parameters(map))
	}
}

impl Encode for Parameters {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.0.len().encode(w);

		for (kind, value) in self.0.iter() {
			kind.encode(w);
			// Per draft-ietf-moq-transport-14 Section 1.4.2:
			// - If Type is even, Value is a single varint (no length prefix)
			// - If Type is odd, Value has a length prefix followed by bytes
			if kind % 2 == 0 {
				// Even: value is stored as encoded varint bytes, write them directly
				w.put_slice(value);
			} else {
				// Odd: encode as length-prefixed bytes
				value.encode(w);
			}
		}
	}
}

impl Parameters {
	pub fn get(&self, kind: u64) -> Option<&Vec<u8>> {
		self.0.get(&kind)
	}

	pub fn set(&mut self, kind: u64, value: Vec<u8>) {
		self.0.insert(kind, value);
	}
}
