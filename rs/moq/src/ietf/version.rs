use crate::coding::{Decode, DecodeError, Encode};

/// Supported MoQ Transport protocol versions
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Version {
	/// draft-ietf-moq-transport-07
	/// <https://www.ietf.org/archive/id/draft-ietf-moq-transport-07.txt>
	Draft07,

	/// draft-ietf-moq-transport-14
	/// <https://www.ietf.org/archive/id/draft-ietf-moq-transport-14.txt>
	Draft14,
}

impl Version {
	/// The current/default version used by this implementation
	pub const CURRENT: Version = Version::Draft07;

	/// Convert version to wire format value
	pub const fn to_u64(self) -> u64 {
		match self {
			Version::Draft07 => 0xff00_0007,
			Version::Draft14 => 0xff00_000e,
		}
	}

	/// Convert from wire format value
	pub const fn from_u64(value: u64) -> Option<Self> {
		match value {
			0xff00_0007 => Some(Version::Draft07),
			0xff00_000e => Some(Version::Draft14),
			_ => None,
		}
	}
}

impl Encode for Version {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.to_u64().encode(w)
	}
}

impl Decode for Version {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let value = u64::decode(r)?;
		Version::from_u64(value).ok_or(DecodeError::InvalidValue)
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_version_to_u64() {
		assert_eq!(Version::Draft07.to_u64(), 0xff00_0007);
		assert_eq!(Version::Draft14.to_u64(), 0xff00_000e);
	}

	#[test]
	fn test_version_from_u64() {
		assert_eq!(Version::from_u64(0xff00_0007), Some(Version::Draft07));
		assert_eq!(Version::from_u64(0xff00_000e), Some(Version::Draft14));
		assert_eq!(Version::from_u64(0xff00_0001), None);
	}

	#[test]
	fn test_version_round_trip() {
		for version in [Version::Draft07, Version::Draft14] {
			let value = version.to_u64();
			assert_eq!(Version::from_u64(value), Some(version));
		}
	}

	#[test]
	fn test_version_encode_decode() {
		use bytes::BytesMut;

		for version in [Version::Draft07, Version::Draft14] {
			let mut buf = BytesMut::new();
			version.encode(&mut buf);

			let mut read_buf = buf.freeze();
			let decoded = Version::decode(&mut read_buf).unwrap();
			assert_eq!(decoded, version);
		}
	}
}
