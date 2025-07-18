use std::{fmt, str::FromStr};

/// A subset of jsonwebtoken algorithms.
///
/// We could support all of them, but there's currently no point using public key crypto.
/// The relay can fetch any resource it wants; it doesn't need to forge tokens.
///
/// TODO support public key crypto at some point.
#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq, Hash)]
pub enum Algorithm {
	HS256,
	HS384,
	HS512,
}

impl From<Algorithm> for jsonwebtoken::Algorithm {
	fn from(val: Algorithm) -> Self {
		match val {
			Algorithm::HS256 => jsonwebtoken::Algorithm::HS256,
			Algorithm::HS384 => jsonwebtoken::Algorithm::HS384,
			Algorithm::HS512 => jsonwebtoken::Algorithm::HS512,
		}
	}
}

impl FromStr for Algorithm {
	type Err = anyhow::Error;

	fn from_str(s: &str) -> Result<Self, Self::Err> {
		match s {
			"HS256" => Ok(Algorithm::HS256),
			"HS384" => Ok(Algorithm::HS384),
			"HS512" => Ok(Algorithm::HS512),
			_ => anyhow::bail!("invalid algorithm: {}", s),
		}
	}
}

impl fmt::Display for Algorithm {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		match self {
			Algorithm::HS256 => write!(f, "HS256"),
			Algorithm::HS384 => write!(f, "HS384"),
			Algorithm::HS512 => write!(f, "HS512"),
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_algorithm_from_str_valid() {
		assert_eq!(Algorithm::from_str("HS256").unwrap(), Algorithm::HS256);
		assert_eq!(Algorithm::from_str("HS384").unwrap(), Algorithm::HS384);
		assert_eq!(Algorithm::from_str("HS512").unwrap(), Algorithm::HS512);
	}

	#[test]
	fn test_algorithm_from_str_invalid() {
		assert!(Algorithm::from_str("HS128").is_err());
		assert!(Algorithm::from_str("RS256").is_err());
		assert!(Algorithm::from_str("invalid").is_err());
		assert!(Algorithm::from_str("").is_err());
	}

	#[test]
	fn test_algorithm_display() {
		assert_eq!(Algorithm::HS256.to_string(), "HS256");
		assert_eq!(Algorithm::HS384.to_string(), "HS384");
		assert_eq!(Algorithm::HS512.to_string(), "HS512");
	}

	#[test]
	fn test_algorithm_to_jsonwebtoken_algorithm() {
		assert_eq!(
			jsonwebtoken::Algorithm::from(Algorithm::HS256),
			jsonwebtoken::Algorithm::HS256
		);
		assert_eq!(
			jsonwebtoken::Algorithm::from(Algorithm::HS384),
			jsonwebtoken::Algorithm::HS384
		);
		assert_eq!(
			jsonwebtoken::Algorithm::from(Algorithm::HS512),
			jsonwebtoken::Algorithm::HS512
		);
	}

	#[test]
	fn test_algorithm_serde() {
		let alg = Algorithm::HS256;
		let json = serde_json::to_string(&alg).unwrap();
		assert_eq!(json, "\"HS256\"");

		let deserialized: Algorithm = serde_json::from_str(&json).unwrap();
		assert_eq!(deserialized, alg);
	}

	#[test]
	fn test_algorithm_equality() {
		assert_eq!(Algorithm::HS256, Algorithm::HS256);
		assert_ne!(Algorithm::HS256, Algorithm::HS384);
		assert_ne!(Algorithm::HS384, Algorithm::HS512);
	}

	#[test]
	fn test_algorithm_clone() {
		let alg = Algorithm::HS256;
		let cloned = alg;
		assert_eq!(alg, cloned);
	}
}
