use std::collections::{hash_map, HashMap};

use anyhow::Context;
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use url::Url;

#[derive(clap::Args, Clone, Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct AuthConfig {
	/// The configuration for the root path.
	#[serde(flatten)]
	#[command(flatten)]
	pub root: AuthRoot,

	/// Configuration overrides based on the path.
	///
	/// WARNING: Nested paths cannot have more strict rules than the root path.
	/// Authentication is currently based on the prefix at connection time.
	/// If you allow public access to root but try to lock down a nested path, IT WILL NOT WORK.
	#[serde(skip_serializing_if = "HashMap::is_empty")]
	#[arg(skip)] // It's too difficult to handle this in clap; use TOML.
	pub path: HashMap<String, AuthRoot>,
}

#[skip_serializing_none]
#[derive(clap::Args, Clone, Debug, Serialize, Deserialize, Default)]
pub struct AuthRoot {
	/// If specified, this key will override the root key for this path.
	/// If not specified, the root key will be used.
	#[arg(long = "auth-key")]
	pub key: Option<String>,

	/// Public access configuration.
	#[serde(default)]
	#[command(flatten)]
	pub public: AuthPublic,
}

#[derive(clap::Args, Clone, Debug, Serialize, Deserialize, Default)]
pub struct AuthPublic {
	/// If specified, this path will either require or not require a token for reading.
	/// If None, the default depends on if a key is configured otherwise the root config will be used.
	#[arg(long = "auth-public-read")]
	pub read: Option<bool>,

	/// If specified, this path will either require or not require a token for writing.
	/// If None, the default depends on if a key is configured otherwise the root config will be used.
	#[arg(long = "auth-public-write")]
	pub write: Option<bool>,
}

// Similar to AuthRoot, but fully qualified.
struct AuthPath {
	pub key: Option<moq_token::Key>,
	pub public_read: bool,
	pub public_write: bool,
}

impl AuthConfig {
	pub fn init(self) -> anyhow::Result<Auth> {
		Auth::new(self)
	}
}

pub struct Auth {
	root: AuthPath,
	paths: HashMap<String, AuthPath>,
}

impl Auth {
	pub fn new(config: AuthConfig) -> anyhow::Result<Self> {
		let mut paths = HashMap::new();

		// Most of this validation is just to avoid accidental security holes.
		let path = match config.root.key.as_deref() {
			None | Some("") => {
				tracing::warn!("no root key configured; all paths will be public");

				let read = config.root.public.read.unwrap_or(true);
				let write = config.root.public.write.unwrap_or(true);

				anyhow::ensure!(read || write, "no root key configured, but no public access either");

				for auth in config.path.values() {
					anyhow::ensure!(
						auth.key.is_none(),
						"no root key configured, but individual paths are configured"
					);

					if (read && auth.public.read == Some(false)) || (write && auth.public.write == Some(false)) {
						anyhow::bail!("nested path cannot be more strict than root");
					}
				}

				return Ok(Self {
					root: AuthPath {
						key: None,
						public_read: read,
						public_write: write,
					},
					paths,
				});
			}
			Some(path) => path,
		};

		// We have a key, so we default to no public access.
		let root_public_read = config.root.public.read.unwrap_or(false);
		let root_public_write = config.root.public.write.unwrap_or(false);

		anyhow::ensure!(
			!root_public_read && !root_public_write,
			"root key configured, but access is public"
		);

		let root_key = moq_token::Key::from_file(path)?;
		anyhow::ensure!(
			root_key.operations.contains(&moq_token::KeyOperation::Verify),
			"key does not support verification"
		);

		for (path, auth) in config.path {
			let path_key = match auth.key.as_deref() {
				// Inherit from the root config if no key is configured.
				None => Some(root_key.clone()),

				// Disable authentication if an empty string is configured.
				Some("") => None,

				// Load the key from the file.
				Some(path) => Some(moq_token::Key::from_file(path)?),
			};

			let path_public_read = match path_key.is_some() {
				// If a key is configured, then default to the root config.
				true => auth.public.read.unwrap_or(root_public_read),

				// If no key is configured, then default to public unless explicitly disabled.
				false => auth.public.read.unwrap_or(true),
			};

			let path_public_write = match path_key.is_some() {
				true => auth.public.write.unwrap_or(root_public_write),
				false => auth.public.write.unwrap_or(true),
			};

			// TODO We should do a similar check for all sub-paths.
			if (root_public_read && !path_public_read) || (root_public_write && !path_public_write) {
				anyhow::bail!("nested path cannot be more strict than root");
			}

			anyhow::ensure!(
				path_key.is_some() || (path_public_read && path_public_write),
				"no key configured, but no public access either"
			);

			match paths.entry(path) {
				hash_map::Entry::Vacant(e) => {
					e.insert(AuthPath {
						key: path_key,
						public_read: path_public_read,
						public_write: path_public_write,
					});
				}
				hash_map::Entry::Occupied(e) => anyhow::bail!("duplicate path: {}", e.key()),
			}
		}

		Ok(Self {
			root: AuthPath {
				key: Some(root_key),
				public_read: root_public_read,
				public_write: root_public_write,
			},
			paths,
		})
	}

	// Parse/validate a user provided URL.
	pub fn validate(&self, url: &Url) -> anyhow::Result<moq_token::Claims> {
		// Find the token in the query parameters.
		// ?jwt=...
		let token = url.query_pairs().find(|(k, _)| k == "jwt").map(|(_, v)| v);

		// Remove the leading / from the path; it's required for URLs.
		let path = url.path().trim_start_matches('/');

		// Default to requiring a token if there's a root key configured.
		let mut auth = &self.root;
		let mut remain = path;

		// Keep removing / until we find a configured key.
		while let Some((prefix, _)) = remain.rsplit_once("/") {
			if let Some(path_auth) = self.paths.get(prefix) {
				// We found the longest configured path.
				auth = path_auth;
				break;
			}

			remain = prefix;
		}

		if let Some(token) = token {
			let key = auth.key.as_ref().context("token used for public path")?;

			// Verify the token and return the payload.
			let mut permissions = key.verify(&token, path)?;

			// Modify the permissions to allow public access if configured.
			// We still use the token's permissions if they exist.
			permissions.publish = permissions.publish.or(auth.public_write.then_some("".to_string()));
			permissions.subscribe = permissions.subscribe.or(auth.public_read.then_some("".to_string()));

			return Ok(permissions);
		}

		// No auth required, so create a dummy token that allows accessing everything.
		Ok(moq_token::Claims {
			path: path.to_string(),
			publish: auth.public_write.then_some("".to_string()),
			subscribe: auth.public_read.then_some("".to_string()),
			..Default::default()
		})
	}
}
