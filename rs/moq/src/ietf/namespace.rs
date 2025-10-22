use crate::{coding::*, Path};

/// Helper function to encode namespace as tuple of strings
pub fn encode_namespace<W: bytes::BufMut>(w: &mut W, namespace: &Path) {
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
pub fn decode_namespace<R: bytes::Buf>(r: &mut R) -> Result<Path<'static>, DecodeError> {
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
