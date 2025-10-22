use std::collections::HashMap;

use crate::coding::*;

#[derive(Default, Debug, Clone)]
pub struct Parameters(HashMap<u64, Vec<u8>>);

impl Decode for Parameters {
	fn decode<R: bytes::Buf>(mut r: &mut R) -> Result<Self, DecodeError> {
		let mut map = HashMap::new();

		// I hate this encoding so much; let me encode my role and get on with my life.
		let count = u64::decode(r)?;
		for _ in 0..count {
			let kind = u64::decode(r)?;
			if map.contains_key(&kind) {
				return Err(DecodeError::DupliateParameter);
			}

			let data = Vec::<u8>::decode(&mut r)?;
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
			value.encode(w);
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
