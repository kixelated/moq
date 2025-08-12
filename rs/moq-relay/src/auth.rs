use std::sync::Arc;

use anyhow::Context;
use moq_lite::{AsPath, Path, PathOwned};
use serde::{Deserialize, Serialize};
use url::Url;

#[derive(clap::Args, Clone, Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct AuthConfig {
	/// The root authentication key.
	/// If present, all paths will require a token unless they are in the public list.
	#[arg(long = "auth-key", env = "MOQ_AUTH_KEY")]
	pub key: Option<String>,

	/// The prefix that will be public for reading and writing.
	/// If present, unauthorized users will be able to read and write to this prefix ONLY.
	/// If a user provides a token, then they can only access the prefix only if it is specified in the token.
	#[arg(long = "auth-public", env = "MOQ_AUTH_PUBLIC")]
	pub public: Option<String>,
}

impl AuthConfig {
	pub fn init(self) -> anyhow::Result<Auth> {
		Auth::new(self)
	}
}

#[derive(Debug)]
pub struct AuthToken {
	pub root: PathOwned,
	pub subscribe: Vec<PathOwned>,
	pub publish: Vec<PathOwned>,
	pub cluster: bool,
}

#[derive(Clone)]
pub struct Auth {
	key: Option<Arc<moq_token::Key>>,
	public: Option<PathOwned>,
}

impl Auth {
	pub fn new(config: AuthConfig) -> anyhow::Result<Self> {
		let key = match config.key.as_deref() {
			Some(path) => Some(moq_token::Key::from_file(path)?),
			None => None,
		};

		let public = config.public;

		match (&key, &public) {
			(None, None) => anyhow::bail!("no root key or public path configured"),
			(Some(_), Some(public)) if public.is_empty() => anyhow::bail!("root key but fully public access"),
			_ => (),
		}

		Ok(Self {
			key: key.map(Arc::new),
			public: public.map(|p| p.as_path().to_owned()),
		})
	}

	// Parse the token from the user provided URL, returning the claims if successful.
	// If no token is provided, then the claims will use the public path if it is set.
	pub fn verify(&self, url: &Url) -> anyhow::Result<AuthToken> {
		// Find the token in the query parameters.
		// ?jwt=...
		let claims = if let Some((_, token)) = url.query_pairs().find(|(k, _)| k == "jwt") {
			if let Some(key) = self.key.as_ref() {
				key.decode(&token)?
			} else {
				anyhow::bail!("token provided, but no key configured");
			}
		} else if let Some(public) = &self.public {
			moq_token::Claims {
				root: public.to_string(),
				subscribe: vec!["".to_string()],
				publish: vec!["".to_string()],
				..Default::default()
			}
		} else {
			anyhow::bail!("no token provided and no public path configured");
		};

		// Get the path from the URL, removing any leading or trailing slashes.
		// We will automatically add a trailing slash when joining the path with the subscribe/publish roots.
		let root = Path::new(url.path());

		// Make sure the URL path matches the root path.
		let suffix = root
			.strip_prefix(&claims.root)
			.context("path does not match the root")?;

		// If a more specific path is is provided, reduce the permissions.
		let subscribe = claims
			.subscribe
			.into_iter()
			.filter_map(|p| {
				let p = Path::new(&p);
				if !p.is_empty() {
					p.strip_prefix(&suffix).map(|p| p.to_owned())
				} else {
					Some(p.to_owned())
				}
			})
			.collect();

		let publish = claims
			.publish
			.into_iter()
			.filter_map(|p| {
				let p = Path::new(&p);
				if !p.is_empty() {
					p.strip_prefix(&suffix).map(|p| p.to_owned())
				} else {
					Some(p.to_owned())
				}
			})
			.collect();

		Ok(AuthToken {
			root: root.to_owned(),
			subscribe,
			publish,
			cluster: claims.cluster,
		})
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use moq_token::{Algorithm, Key};
	use tempfile::NamedTempFile;

	fn create_test_key() -> anyhow::Result<(NamedTempFile, Key)> {
		let key_file = NamedTempFile::new()?;
		let key = Key::generate(Algorithm::HS256, None);
		key.to_file(key_file.path())?;
		Ok((key_file, key))
	}

	#[test]
	fn test_anonymous_access_with_public_path() -> anyhow::Result<()> {
		// Test anonymous access to /anon path
		let auth = Auth::new(AuthConfig {
			key: None,
			public: Some("anon".to_string()),
		})?;

		// Should succeed for anonymous path
		let url = Url::parse("https://relay.example.com/anon")?;
		let token = auth.verify(&url)?;
		assert_eq!(token.root, "anon".as_path());
		assert_eq!(token.subscribe, vec!["".as_path()]);
		assert_eq!(token.publish, vec!["".as_path()]);

		// Should succeed for sub-paths under anonymous
		let url = Url::parse("https://relay.example.com/anon/room/123")?;
		let token = auth.verify(&url)?;
		assert_eq!(token.root, Path::new("anon/room/123").to_owned());
		assert_eq!(token.subscribe, vec![Path::new("").to_owned()]);
		assert_eq!(token.publish, vec![Path::new("").to_owned()]);

		Ok(())
	}

	#[test]
	fn test_anonymous_access_fully_public() -> anyhow::Result<()> {
		// Test fully public access (public = "")
		let auth = Auth::new(AuthConfig {
			key: None,
			public: Some("".to_string()),
		})?;

		// Should succeed for any path
		let url = Url::parse("https://relay.example.com/any/path")?;
		let token = auth.verify(&url)?;
		assert_eq!(token.root, Path::new("any/path").to_owned());
		assert_eq!(token.subscribe, vec![Path::new("").to_owned()]);
		assert_eq!(token.publish, vec![Path::new("").to_owned()]);

		Ok(())
	}

	#[test]
	fn test_anonymous_access_denied_wrong_prefix() -> anyhow::Result<()> {
		// Test anonymous access denied for wrong prefix
		let auth = Auth::new(AuthConfig {
			key: None,
			public: Some("anon".to_string()),
		})?;

		// Should fail for non-anonymous path
		let url = Url::parse("https://relay.example.com/secret")?;
		let result = auth.verify(&url);
		assert!(result.is_err());
		assert!(result.unwrap_err().to_string().contains("path does not match the root"));

		Ok(())
	}

	#[test]
	fn test_no_token_no_public_path_fails() -> anyhow::Result<()> {
		let (key_file, _) = create_test_key()?;
		let auth = Auth::new(AuthConfig {
			key: Some(key_file.path().to_string_lossy().to_string()),
			public: None,
		})?;

		// Should fail when no token and no public path
		let url = Url::parse("https://relay.example.com/any/path")?;
		let result = auth.verify(&url);
		assert!(result.is_err());
		assert!(result
			.unwrap_err()
			.to_string()
			.contains("no token provided and no public path configured"));

		Ok(())
	}

	#[test]
	fn test_token_provided_but_no_key_configured() -> anyhow::Result<()> {
		let auth = Auth::new(AuthConfig {
			key: None,
			public: Some("anon".to_string()),
		})?;

		// Should fail when token provided but no key configured
		let url = Url::parse("https://relay.example.com/any/path?jwt=fake-token")?;
		let result = auth.verify(&url);
		assert!(result.is_err());
		assert!(result
			.unwrap_err()
			.to_string()
			.contains("token provided, but no key configured"));

		Ok(())
	}

	#[test]
	fn test_jwt_token_basic_validation() -> anyhow::Result<()> {
		let (key_file, key) = create_test_key()?;
		let auth = Auth::new(AuthConfig {
			key: Some(key_file.path().to_string_lossy().to_string()),
			public: None,
		})?;

		// Create a token with basic permissions
		let claims = moq_token::Claims {
			root: "room/123".to_string(),
			subscribe: vec!["".to_string()],
			publish: vec!["alice".into()],
			..Default::default()
		};
		let token = key.encode(&claims)?;

		// Should succeed with valid token and matching path
		let url = Url::parse(&format!("https://relay.example.com/room/123?jwt={token}"))?;
		let token = auth.verify(&url)?;
		assert_eq!(token.root, "room/123".as_path());
		assert_eq!(token.subscribe, vec!["".as_path()]);
		assert_eq!(token.publish, vec!["alice".as_path()]);

		Ok(())
	}

	#[test]
	fn test_jwt_token_wrong_root_path() -> anyhow::Result<()> {
		let (key_file, key) = create_test_key()?;
		let auth = Auth::new(AuthConfig {
			key: Some(key_file.path().to_string_lossy().to_string()),
			public: None,
		})?;

		// Create a token for room/123
		let claims = moq_token::Claims {
			root: "room/123".to_string(),
			subscribe: vec!["".to_string()],
			publish: vec!["".to_string()],
			..Default::default()
		};
		let token = key.encode(&claims)?;

		// Should fail when trying to access wrong path
		let url = Url::parse(&format!("https://relay.example.com/secret?jwt={token}"))?;
		let result = auth.verify(&url);
		assert!(result.is_err());
		assert!(result.unwrap_err().to_string().contains("path does not match the root"));

		Ok(())
	}

	#[test]
	fn test_jwt_token_with_restricted_publish_subscribe() -> anyhow::Result<()> {
		let (key_file, key) = create_test_key()?;
		let auth = Auth::new(AuthConfig {
			key: Some(key_file.path().to_string_lossy().to_string()),
			public: None,
		})?;

		// Create a token with specific pub/sub restrictions
		let claims = moq_token::Claims {
			root: "room/123".to_string(),
			subscribe: vec!["bob".into()],
			publish: vec!["alice".into()],
			..Default::default()
		};
		let token = key.encode(&claims)?;

		// Verify the restrictions are preserved
		let url = Url::parse(&format!("https://relay.example.com/room/123?jwt={token}"))?;
		let token = auth.verify(&url)?;
		assert_eq!(token.root, "room/123".as_path());
		assert_eq!(token.subscribe, vec!["bob".as_path()]);
		assert_eq!(token.publish, vec!["alice".as_path()]);

		Ok(())
	}

	#[test]
	fn test_jwt_token_read_only() -> anyhow::Result<()> {
		let (key_file, key) = create_test_key()?;
		let auth = Auth::new(AuthConfig {
			key: Some(key_file.path().to_string_lossy().to_string()),
			public: None,
		})?;

		// Create a read-only token (no publish permissions)
		let claims = moq_token::Claims {
			root: "room/123".to_string(),
			subscribe: vec!["".to_string()],
			publish: vec![],
			..Default::default()
		};
		let token = key.encode(&claims)?;

		let url = Url::parse(&format!("https://relay.example.com/room/123?jwt={token}"))?;
		let token = auth.verify(&url)?;
		assert_eq!(token.subscribe, vec!["".as_path()]);
		assert_eq!(token.publish, vec![]);

		Ok(())
	}

	#[test]
	fn test_jwt_token_write_only() -> anyhow::Result<()> {
		let (key_file, key) = create_test_key()?;
		let auth = Auth::new(AuthConfig {
			key: Some(key_file.path().to_string_lossy().to_string()),
			public: None,
		})?;

		// Create a write-only token (no subscribe permissions)
		let claims = moq_token::Claims {
			root: "room/123".to_string(),
			subscribe: vec![],
			publish: vec!["bob".into()],
			..Default::default()
		};
		let token = key.encode(&claims)?;

		let url = Url::parse(&format!("https://relay.example.com/room/123?jwt={token}"))?;
		let token = auth.verify(&url)?;
		assert_eq!(token.subscribe, vec![]);
		assert_eq!(token.publish, vec!["bob".as_path()]);

		Ok(())
	}

	#[test]
	fn test_claims_reduction_basic() -> anyhow::Result<()> {
		let (key_file, key) = create_test_key()?;
		let auth = Auth::new(AuthConfig {
			key: Some(key_file.path().to_string_lossy().to_string()),
			public: None,
		})?;

		// Create a token with root at room/123 and unrestricted pub/sub
		let claims = moq_token::Claims {
			root: "room/123".to_string(),
			subscribe: vec!["".to_string()],
			publish: vec!["".to_string()],
			..Default::default()
		};
		let token = key.encode(&claims)?;

		// Connect to more specific path room/123/alice
		let url = Url::parse(&format!("https://relay.example.com/room/123/alice?jwt={token}"))?;
		let token = auth.verify(&url)?;

		// Root should be updated to the more specific path
		assert_eq!(token.root, Path::new("room/123/alice"));
		// Empty permissions remain empty (full access under new root)
		assert_eq!(token.subscribe, vec!["".as_path()]);
		assert_eq!(token.publish, vec!["".as_path()]);

		Ok(())
	}

	#[test]
	fn test_claims_reduction_with_publish_restrictions() -> anyhow::Result<()> {
		let (key_file, key) = create_test_key()?;
		let auth = Auth::new(AuthConfig {
			key: Some(key_file.path().to_string_lossy().to_string()),
			public: None,
		})?;

		// Token allows publishing only to alice/*
		let claims = moq_token::Claims {
			root: "room/123".to_string(),
			subscribe: vec!["".to_string()],
			publish: vec!["alice".into()],
			..Default::default()
		};
		let token = key.encode(&claims)?;

		// Connect to room/123/alice - should remove alice prefix from publish
		let url = Url::parse(&format!("https://relay.example.com/room/123/alice?jwt={token}"))?;
		let token = auth.verify(&url)?;

		assert_eq!(token.root, "room/123/alice".as_path());
		// Alice still can't subscribe to anything.
		assert_eq!(token.subscribe, vec!["".as_path()]);
		// alice prefix stripped, now can publish to everything under room/123/alice
		assert_eq!(token.publish, vec!["".as_path()]);

		Ok(())
	}

	#[test]
	fn test_claims_reduction_with_subscribe_restrictions() -> anyhow::Result<()> {
		let (key_file, key) = create_test_key()?;
		let auth = Auth::new(AuthConfig {
			key: Some(key_file.path().to_string_lossy().to_string()),
			public: None,
		})?;

		// Token allows subscribing only to bob/*
		let claims = moq_token::Claims {
			root: "room/123".to_string(),
			subscribe: vec!["bob".into()],
			publish: vec!["".to_string()],
			..Default::default()
		};
		let token = key.encode(&claims)?;

		// Connect to room/123/bob - should remove bob prefix from subscribe
		let url = Url::parse(&format!("https://relay.example.com/room/123/bob?jwt={token}"))?;
		let token = auth.verify(&url)?;

		assert_eq!(token.root, "room/123/bob".as_path());
		// bob prefix stripped, now can subscribe to everything under room/123/bob
		assert_eq!(token.subscribe, vec!["".as_path()]);
		assert_eq!(token.publish, vec!["".as_path()]);

		Ok(())
	}

	#[test]
	fn test_claims_reduction_loses_access() -> anyhow::Result<()> {
		let (key_file, key) = create_test_key()?;
		let auth = Auth::new(AuthConfig {
			key: Some(key_file.path().to_string_lossy().to_string()),
			public: None,
		})?;

		// Token allows publishing to alice/* and subscribing to bob/*
		let claims = moq_token::Claims {
			root: "room/123".to_string(),
			subscribe: vec!["bob".into()],
			publish: vec!["alice".into()],
			..Default::default()
		};
		let token = key.encode(&claims)?;

		// Connect to room/123/alice - loses ability to subscribe to bob
		let url = Url::parse(&format!("https://relay.example.com/room/123/alice?jwt={token}"))?;
		let verified = auth.verify(&url)?;

		assert_eq!(verified.root, "room/123/alice".as_path());
		// Can't subscribe to bob anymore (alice doesn't have bob prefix)
		assert_eq!(verified.subscribe, vec![]);
		// Can publish to everything under alice
		assert_eq!(verified.publish, vec!["".as_path()]);

		// Connect to room/123/bob - loses ability to publish to alice
		let url = Url::parse(&format!("https://relay.example.com/room/123/bob?jwt={token}"))?;
		let token = auth.verify(&url)?;

		assert_eq!(token.root, "room/123/bob".as_path());
		// Can subscribe to everything under bob
		assert_eq!(token.subscribe, vec!["".as_path()]);
		// Can't publish to alice anymore (bob doesn't have alice prefix)
		assert_eq!(token.publish, vec![]);

		Ok(())
	}

	#[test]
	fn test_claims_reduction_nested_paths() -> anyhow::Result<()> {
		let (key_file, key) = create_test_key()?;
		let auth = Auth::new(AuthConfig {
			key: Some(key_file.path().to_string_lossy().to_string()),
			public: None,
		})?;

		// Token with nested publish/subscribe paths
		let claims = moq_token::Claims {
			root: "room/123".to_string(),
			subscribe: vec!["users/bob/screen".into()],
			publish: vec!["users/alice/camera".into()],
			..Default::default()
		};
		let token = key.encode(&claims)?;

		// Connect to room/123/users - permissions should be reduced
		let url = Url::parse(&format!("https://relay.example.com/room/123/users?jwt={token}"))?;
		let verified = auth.verify(&url)?;

		assert_eq!(verified.root, "room/123/users".as_path());
		// users prefix removed from paths
		assert_eq!(verified.subscribe, vec!["bob/screen".as_path()]);
		assert_eq!(verified.publish, vec!["alice/camera".as_path()]);

		// Connect to room/123/users/alice - further reduction
		let url = Url::parse(&format!("https://relay.example.com/room/123/users/alice?jwt={token}"))?;
		let token = auth.verify(&url)?;

		assert_eq!(token.root, "room/123/users/alice".as_path());
		// Can't subscribe (alice doesn't have bob prefix)
		assert_eq!(token.subscribe, vec![]);
		// users/alice prefix removed, left with camera
		assert_eq!(token.publish, vec!["camera".as_path()]);

		Ok(())
	}

	#[test]
	fn test_claims_reduction_preserves_read_write_only() -> anyhow::Result<()> {
		let (key_file, key) = create_test_key()?;
		let auth = Auth::new(AuthConfig {
			key: Some(key_file.path().to_string_lossy().to_string()),
			public: None,
		})?;

		// Read-only token
		let claims = moq_token::Claims {
			root: "room/123".to_string(),
			subscribe: vec!["alice".into()],
			publish: vec![],
			..Default::default()
		};
		let token = key.encode(&claims)?;

		// Connect to more specific path
		let url = Url::parse(&format!("https://relay.example.com/room/123/alice?jwt={token}"))?;
		let token = auth.verify(&url)?;

		// Should remain read-only
		assert_eq!(token.subscribe, vec!["".as_path()]);
		assert_eq!(token.publish, vec![]);

		// Write-only token
		let claims = moq_token::Claims {
			root: "room/123".to_string(),
			subscribe: vec![],
			publish: vec!["alice".into()],
			..Default::default()
		};
		let token = key.encode(&claims)?;

		let url = Url::parse(&format!("https://relay.example.com/room/123/alice?jwt={token}"))?;
		let verified = auth.verify(&url)?;

		// Should remain write-only
		assert_eq!(verified.subscribe, vec![]);
		assert_eq!(verified.publish, vec!["".as_path()]);

		Ok(())
	}
}
