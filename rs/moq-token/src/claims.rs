use serde::{Deserialize, Serialize};
use serde_with::{serde_as, TimestampSeconds};

fn is_false(value: &bool) -> bool {
	!value
}

#[serde_as]
#[derive(Debug, Serialize, Deserialize, Default)]
#[serde_with::skip_serializing_none]
#[serde(default)]
pub struct Claims {
	/// The URL path that this token is valid for, minus the starting `/`.
	///
	/// This path is the root for all other publish/subscribe paths below.
	/// If the combined path ends with a `/`, then it's treated as a prefix.
	/// If the combined path does not end with a `/`, then it's treated as a specific broadcast.
	#[serde(rename = "path")]
	pub path: String,

	/// If specified, the user can publish any matching broadcasts.
	/// If not specified, the user will not publish any broadcasts.
	///
	/// If the full path does not end with `/`, then the user will publish the specific broadcast.
	/// They will need to announce it of course.
	#[serde(rename = "pub")]
	pub publish: Option<String>,

	/// If true, then this client is considered a cluster node.
	/// Both the client and server will only announce broadcasts from non-cluster clients.
	/// This avoids convoluted routing, as only the primary origin will announce.
	#[serde(default, rename = "cluster", skip_serializing_if = "is_false")]
	pub cluster: bool,

	/// If specified, the user can subscribe to any matching broadcasts.
	/// If not specified, the user will not receive announcements and cannot subscribe to any broadcasts.
	#[serde(rename = "sub")]
	pub subscribe: Option<String>,

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
		if self.publish.is_none() && self.subscribe.is_none() {
			anyhow::bail!("no publish or subscribe paths specified; token is useless");
		}

		if !self.path.is_empty() && !self.path.ends_with("/") {
			// If the path doesn't end with /, then we need to make sure the other paths are empty or start with /
			if let Some(publish) = &self.publish {
				if !publish.is_empty() && !publish.starts_with("/") {
					anyhow::bail!("path is not a prefix, so publish can't be relative");
				}
			}

			if let Some(subscribe) = &self.subscribe {
				if !subscribe.is_empty() && !subscribe.starts_with("/") {
					anyhow::bail!("path is not a prefix, so subscribe can't be relative");
				}
			}
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
			path: "test-path/".to_string(),
			publish: Some("test-pub".to_string()),
			cluster: false,
			subscribe: Some("test-sub".to_string()),
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
			path: "test-path/".to_string(),
			publish: None,
			subscribe: None,
			cluster: false,
			expires: None,
			issued: None,
		};

		let result = claims.validate();
		assert!(result.is_err());
		assert!(result
			.unwrap_err()
			.to_string()
			.contains("no publish or subscribe paths specified"));
	}

	#[test]
	fn test_claims_validation_only_publish() {
		let claims = Claims {
			path: "test-path/".to_string(),
			publish: Some("test-pub".to_string()),
			subscribe: None,
			cluster: false,
			expires: None,
			issued: None,
		};

		assert!(claims.validate().is_ok());
	}

	#[test]
	fn test_claims_validation_only_subscribe() {
		let claims = Claims {
			path: "test-path/".to_string(),
			publish: None,
			subscribe: Some("test-sub".to_string()),
			cluster: false,
			expires: None,
			issued: None,
		};

		assert!(claims.validate().is_ok());
	}

	#[test]
	fn test_claims_validation_path_not_prefix_relative_publish() {
		let claims = Claims {
			path: "test-path".to_string(),             // no trailing slash
			publish: Some("relative-pub".to_string()), // relative path without leading slash
			subscribe: None,
			cluster: false,
			expires: None,
			issued: None,
		};

		let result = claims.validate();
		assert!(result.is_err());
		assert!(result
			.unwrap_err()
			.to_string()
			.contains("path is not a prefix, so publish can't be relative"));
	}

	#[test]
	fn test_claims_validation_path_not_prefix_relative_subscribe() {
		let claims = Claims {
			path: "test-path".to_string(), // no trailing slash
			publish: None,
			subscribe: Some("relative-sub".to_string()), // relative path without leading slash
			cluster: false,
			expires: None,
			issued: None,
		};

		let result = claims.validate();
		assert!(result.is_err());
		assert!(result
			.unwrap_err()
			.to_string()
			.contains("path is not a prefix, so subscribe can't be relative"));
	}

	#[test]
	fn test_claims_validation_path_not_prefix_absolute_publish() {
		let claims = Claims {
			path: "test-path".to_string(),              // no trailing slash
			publish: Some("/absolute-pub".to_string()), // absolute path with leading slash
			subscribe: None,
			cluster: false,
			expires: None,
			issued: None,
		};

		assert!(claims.validate().is_ok());
	}

	#[test]
	fn test_claims_validation_path_not_prefix_absolute_subscribe() {
		let claims = Claims {
			path: "test-path".to_string(), // no trailing slash
			publish: None,
			subscribe: Some("/absolute-sub".to_string()), // absolute path with leading slash
			cluster: false,
			expires: None,
			issued: None,
		};

		assert!(claims.validate().is_ok());
	}

	#[test]
	fn test_claims_validation_path_not_prefix_empty_publish() {
		let claims = Claims {
			path: "test-path".to_string(), // no trailing slash
			publish: Some("".to_string()), // empty string
			subscribe: None,
			cluster: false,
			expires: None,
			issued: None,
		};

		assert!(claims.validate().is_ok());
	}

	#[test]
	fn test_claims_validation_path_not_prefix_empty_subscribe() {
		let claims = Claims {
			path: "test-path".to_string(), // no trailing slash
			publish: None,
			subscribe: Some("".to_string()), // empty string
			cluster: false,
			expires: None,
			issued: None,
		};

		assert!(claims.validate().is_ok());
	}

	#[test]
	fn test_claims_validation_path_is_prefix() {
		let claims = Claims {
			path: "test-path/".to_string(),              // with trailing slash
			publish: Some("relative-pub".to_string()),   // relative path is ok when path is prefix
			subscribe: Some("relative-sub".to_string()), // relative path is ok when path is prefix
			cluster: false,
			expires: None,
			issued: None,
		};

		assert!(claims.validate().is_ok());
	}

	#[test]
	fn test_claims_validation_empty_path() {
		let claims = Claims {
			path: "".to_string(), // empty path
			publish: Some("test-pub".to_string()),
			subscribe: None,
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

		assert_eq!(deserialized.path, claims.path);
		assert_eq!(deserialized.publish, claims.publish);
		assert_eq!(deserialized.subscribe, claims.subscribe);
		assert_eq!(deserialized.cluster, claims.cluster);
	}

	#[test]
	fn test_claims_default() {
		let claims = Claims::default();
		assert_eq!(claims.path, "");
		assert_eq!(claims.publish, None);
		assert_eq!(claims.subscribe, None);
		assert!(!claims.cluster);
		assert_eq!(claims.expires, None);
		assert_eq!(claims.issued, None);
	}

	#[test]
	fn test_is_false_helper() {
		assert!(is_false(&false));
		assert!(!is_false(&true));
	}
}
