use serde::{Deserialize, Serialize};
use serde_with::{serde_as, TimestampSeconds};

fn is_false(value: &bool) -> bool {
	!value
}

// Temporary for backwards compatibility.
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(untagged)]
pub enum Paths {
	#[default]
	None,
	One(String),
	Multi(Vec<String>),
}

impl Paths {
	pub fn is_empty(&self) -> bool {
		match self {
			Paths::None => true,
			Paths::One(_) => false,
			Paths::Multi(paths) => paths.is_empty(),
		}
	}

	pub fn into_vec(self) -> Vec<String> {
		match self {
			Paths::None => vec![],
			Paths::One(path) => vec![path],
			Paths::Multi(paths) => paths,
		}
	}
}

impl From<String> for Paths {
	fn from(value: String) -> Self {
		Paths::One(value)
	}
}

impl From<&str> for Paths {
	fn from(value: &str) -> Self {
		Paths::One(value.to_string())
	}
}

impl From<Vec<String>> for Paths {
	fn from(value: Vec<String>) -> Self {
		Paths::Multi(value)
	}
}

impl<T: ToString> From<&[T]> for Paths {
	fn from(value: &[T]) -> Self {
		Paths::Multi(value.iter().map(|v| v.to_string()).collect())
	}
}

impl From<Option<String>> for Paths {
	fn from(value: Option<String>) -> Self {
		match value {
			Some(value) => Paths::One(value),
			None => Paths::None,
		}
	}
}

impl PartialEq for Paths {
	fn eq(&self, other: &Self) -> bool {
		match self {
			Paths::None => match other {
				Paths::None => true,
				Paths::Multi(b) => b.is_empty(),
				Paths::One(_) => false,
			},
			Paths::One(a) => match other {
				Paths::Multi(b) if b.len() == 1 => b[0] == *a,
				Paths::One(b) => a == b,
				_ => false,
			},
			Paths::Multi(a) => match other {
				Paths::Multi(b) => a == b,
				Paths::One(b) => a.len() == 1 && a[0] == *b,
				Paths::None => false,
			},
		}
	}
}

#[serde_as]
#[derive(Debug, Serialize, Deserialize, Default, Clone)]
#[serde_with::skip_serializing_none]
#[serde(default)]
pub struct Claims {
	/// The root for the publish/subscribe options below.
	/// It's mostly for compression and is optional, defaulting to the empty string.
	#[serde(default, rename = "root", skip_serializing_if = "String::is_empty")]
	pub root: String,

	/// If specified, the user can publish any matching broadcasts.
	/// If not specified, the user will not publish any broadcasts.
	#[serde(rename = "pub", skip_serializing_if = "Paths::is_empty")]
	pub publish: Paths,

	/// If true, then this client is considered a cluster node.
	/// Both the client and server will only announce broadcasts from non-cluster clients.
	/// This avoids convoluted routing, as only the primary origin will announce.
	#[serde(default, rename = "cluster", skip_serializing_if = "is_false")]
	pub cluster: bool,

	/// If specified, the user can subscribe to any matching broadcasts.
	/// If not specified, the user will not receive announcements and cannot subscribe to any broadcasts.
	#[serde(rename = "sub", skip_serializing_if = "Paths::is_empty")]
	pub subscribe: Paths,

	/// The expiration time of the token as a unix timestamp.
	#[serde(rename = "exp")]
	#[serde_as(as = "Option<TimestampSeconds<i64>>")]
	pub expires: Option<std::time::SystemTime>,

	/// The issued time of the token as a unix timestamp.
	#[serde(rename = "iat")]
	#[serde_as(as = "Option<TimestampSeconds<i64>>")]
	pub issued: Option<std::time::SystemTime>,
}

impl Claims {
	pub fn validate(&self) -> anyhow::Result<()> {
		if self.publish.is_empty() && self.subscribe.is_empty() {
			anyhow::bail!("no publish or subscribe allowed; token is useless");
		}

		Ok(())
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	use std::time::{Duration, SystemTime};

	fn create_test_claims() -> Claims {
		Claims {
			root: "test-path".to_string(),
			publish: "test-pub".into(),
			cluster: false,
			subscribe: "test-sub".into(),
			expires: Some(SystemTime::now() + Duration::from_secs(3600)),
			issued: Some(SystemTime::now()),
		}
	}

	#[test]
	fn test_claims_validation_success() {
		let claims = create_test_claims();
		assert!(claims.validate().is_ok());
	}

	#[test]
	fn test_claims_validation_no_publish_or_subscribe() {
		let claims = Claims {
			root: "test-path".to_string(),
			publish: None.into(),
			subscribe: None.into(),
			cluster: false,
			expires: None,
			issued: None,
		};

		let result = claims.validate();
		assert!(result.is_err());
		assert!(result
			.unwrap_err()
			.to_string()
			.contains("no publish or subscribe allowed; token is useless"));
	}

	#[test]
	fn test_claims_validation_only_publish() {
		let claims = Claims {
			root: "test-path".to_string(),
			publish: "test-pub".into(),
			subscribe: None.into(),
			cluster: false,
			expires: None,
			issued: None,
		};

		assert!(claims.validate().is_ok());
	}

	#[test]
	fn test_claims_validation_only_subscribe() {
		let claims = Claims {
			root: "test-path".to_string(),
			publish: None.into(),
			subscribe: "test-sub".into(),
			cluster: false,
			expires: None,
			issued: None,
		};

		assert!(claims.validate().is_ok());
	}

	#[test]
	fn test_claims_validation_path_not_prefix_relative_publish() {
		let claims = Claims {
			root: "test-path".to_string(),  // no trailing slash
			publish: "relative-pub".into(), // relative path without leading slash
			subscribe: None.into(),
			cluster: false,
			expires: None,
			issued: None,
		};

		let result = claims.validate();
		assert!(result.is_ok()); // Now passes because slashes are implicitly added
	}

	#[test]
	fn test_claims_validation_path_not_prefix_relative_subscribe() {
		let claims = Claims {
			root: "test-path".to_string(), // no trailing slash
			publish: None.into(),
			subscribe: "relative-sub".into(), // relative path without leading slash
			cluster: false,
			expires: None,
			issued: None,
		};

		let result = claims.validate();
		assert!(result.is_ok()); // Now passes because slashes are implicitly added
	}

	#[test]
	fn test_claims_validation_path_not_prefix_absolute_publish() {
		let claims = Claims {
			root: "test-path".to_string(),   // no trailing slash
			publish: "/absolute-pub".into(), // absolute path with leading slash
			subscribe: None.into(),
			cluster: false,
			expires: None,
			issued: None,
		};

		assert!(claims.validate().is_ok());
	}

	#[test]
	fn test_claims_validation_path_not_prefix_absolute_subscribe() {
		let claims = Claims {
			root: "test-path".to_string(), // no trailing slash
			publish: None.into(),
			subscribe: "/absolute-sub".into(), // absolute path with leading slash
			cluster: false,
			expires: None,
			issued: None,
		};

		assert!(claims.validate().is_ok());
	}

	#[test]
	fn test_claims_validation_path_not_prefix_empty_publish() {
		let claims = Claims {
			root: "test-path".to_string(), // no trailing slash
			publish: "".into(),            // empty string
			subscribe: None.into(),
			cluster: false,
			expires: None,
			issued: None,
		};

		assert!(claims.validate().is_ok());
	}

	#[test]
	fn test_claims_validation_path_not_prefix_empty_subscribe() {
		let claims = Claims {
			root: "test-path".to_string(), // no trailing slash
			publish: None.into(),
			subscribe: "".into(), // empty string
			cluster: false,
			expires: None,
			issued: None,
		};

		assert!(claims.validate().is_ok());
	}

	#[test]
	fn test_claims_validation_path_is_prefix() {
		let claims = Claims {
			root: "test-path".to_string(),    // with trailing slash
			publish: "relative-pub".into(),   // relative path is ok when path is prefix
			subscribe: "relative-sub".into(), // relative path is ok when path is prefix
			cluster: false,
			expires: None,
			issued: None,
		};

		assert!(claims.validate().is_ok());
	}

	#[test]
	fn test_claims_validation_empty_path() {
		let claims = Claims {
			root: "".to_string(), // empty path
			publish: "test-pub".into(),
			subscribe: None.into(),
			cluster: false,
			expires: None,
			issued: None,
		};

		assert!(claims.validate().is_ok());
	}

	#[test]
	fn test_claims_serde() {
		let claims = create_test_claims();
		let json = serde_json::to_string(&claims).unwrap();
		let deserialized: Claims = serde_json::from_str(&json).unwrap();

		assert_eq!(deserialized.root, claims.root);
		assert_eq!(deserialized.publish, claims.publish);
		assert_eq!(deserialized.subscribe, claims.subscribe);
		assert_eq!(deserialized.cluster, claims.cluster);
	}

	#[test]
	fn test_claims_default() {
		let claims = Claims::default();
		assert_eq!(claims.root, "");
		assert_eq!(claims.publish, Paths::None);
		assert_eq!(claims.subscribe, Paths::None);
		assert!(!claims.cluster);
		assert_eq!(claims.expires, None);
		assert_eq!(claims.issued, None);
	}

	#[test]
	fn test_is_false_helper() {
		assert!(is_false(&false));
		assert!(!is_false(&true));
	}

	#[test]
	fn test_backwards_compat_option_to_vec() {
		// Test old format with Some(path)
		let old_json = r#"{
			"root": "test-path",
			"pub": "test-pub",
			"sub": "test-sub",
			"cluster": false
		}"#;

		let claims: Claims = serde_json::from_str(old_json).unwrap();
		assert_eq!(claims.root, "test-path");
		assert_eq!(claims.publish, "test-pub".into());
		assert_eq!(claims.subscribe, "test-sub".into());
		assert!(!claims.cluster);

		// Test old format with null (None)
		let old_json_null = r#"{
			"root": "",
			"pub": null,
			"sub": null,
			"cluster": false
		}"#;

		let claims: Claims = serde_json::from_str(old_json_null).unwrap();
		assert_eq!(claims.root, "");
		assert_eq!(claims.publish, Paths::None);
		assert_eq!(claims.subscribe, Paths::None);
		assert!(!claims.cluster);

		// Test new format with arrays
		let new_json = r#"{
			"root": "test-path",
			"pub": ["test-pub1", "test-pub2"],
			"sub": ["test-sub1", "test-sub2"],
			"cluster": false
		}"#;

		let claims: Claims = serde_json::from_str(new_json).unwrap();
		assert_eq!(claims.root, "test-path");
		assert_eq!(
			claims.publish,
			vec!["test-pub1".to_string(), "test-pub2".to_string()].into()
		);
		assert_eq!(
			claims.subscribe,
			vec!["test-sub1".to_string(), "test-sub2".to_string()].into()
		);
		assert!(!claims.cluster);

		// Test new format with empty arrays
		let new_json_empty = r#"{
			"root": "",
			"pub": [],
			"sub": [],
			"cluster": false
		}"#;

		let claims: Claims = serde_json::from_str(new_json_empty).unwrap();
		assert_eq!(claims.root, "");
		assert_eq!(claims.publish, vec![].into());
		assert_eq!(claims.subscribe, vec![].into());
		assert!(!claims.cluster);
	}

	#[test]
	fn test_jwt_payload_decode() {
		// This is the exact JSON from the JWT token that's failing
		let json = r#"{"root":"test-path","pub":["test-pub"],"sub":["test-sub"],"exp":1754942220,"iat":1754938620}"#;
		let claims: Claims = serde_json::from_str(json).unwrap();
		assert_eq!(claims.root.as_str(), "test-path");
		assert_eq!(claims.publish, "test-pub".into());
		assert_eq!(claims.subscribe, "test-sub".into());
		assert!(claims.expires.is_some());
		assert!(claims.issued.is_some());
	}
}
