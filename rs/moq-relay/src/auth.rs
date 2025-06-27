use std::{collections::HashMap, sync::Arc};

use anyhow::Context;
use serde::{Deserialize, Serialize};
use url::Url;

#[serde_with::serde_as]
#[derive(clap::Args, Clone, Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct AuthConfig {
	/// The root key to use for all connections.
	///
	/// This is the fallback if a path does not exist in the `path` map below.
	/// If this is missing, then authentication is completely disabled, even if a path is configured below.
	#[serde(skip_serializing_if = "Option::is_none")]
	#[arg(long = "auth-key")]
	pub key: Option<String>,

	/// A map of paths to key files.
	///
	/// We'll use this k
	#[serde(skip_serializing_if = "Option::is_none")]
	#[arg(long = "auth-path", value_parser = parse_key_val)]
	pub path: Option<Vec<AuthPath>>,
}

#[serde_with::serde_as]
#[derive(clap::Args, Clone, Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct AuthPath {
	pub root: String,
	pub key: String,
}

impl AuthConfig {
	pub fn init(self) -> anyhow::Result<Auth> {
		Auth::new(self)
	}
}

// root=key,root=key,root=key
fn parse_key_val(s: &str) -> Result<Vec<AuthPath>, String> {
	if s.is_empty() {
		return Ok(vec![]);
	}

	let mut paths = vec![];
	for part in s.split(",") {
		let (root, key) = part
			.split_once('=')
			.ok_or_else(|| format!("invalid KEY=VALUE: no `=` in `{}`", s))?;
		paths.push(AuthPath {
			root: root.to_string(),
			key: key.to_string(),
		});
	}

	Ok(paths)
}

pub struct Auth {
	key: Option<moq_token::Key>,
	paths: Arc<HashMap<String, Option<moq_token::Key>>>,
}

impl Auth {
	pub fn new(config: AuthConfig) -> anyhow::Result<Self> {
		let mut paths = HashMap::new();

		let key = match config.key.as_deref() {
			None | Some("") => {
				tracing::warn!("connection authentication is disabled; users can publish/subscribe to any path");
				None
			}
			Some(path) => {
				let key = moq_token::Key::from_file(path)?;
				anyhow::ensure!(
					key.operations.contains(&moq_token::KeyOperation::Verify),
					"key does not support verification"
				);
				Some(key)
			}
		};

		for path in config.path.unwrap_or_default() {
			let key = match path.key.as_ref() {
				"" => None,
				path => {
					let key = moq_token::Key::from_file(path)?;
					anyhow::ensure!(
						key.operations.contains(&moq_token::KeyOperation::Verify),
						"key does not support verification"
					);
					Some(key)
				}
			};

			paths.insert(path.root, key);
		}

		Ok(Self {
			key,
			paths: Arc::new(paths),
		})
	}

	// Parse/validate a user provided URL.
	pub fn validate(&self, url: &Url) -> anyhow::Result<moq_token::Payload> {
		// Find the token in the query parameters.
		// ?jwt=...
		let token = url.query_pairs().find(|(k, _)| k == "jwt").map(|(_, v)| v);

		let path = url.path().trim_start_matches('/');

		// Default to requiring a token if there's a root key configured.
		let mut key = &self.key;

		// Keep removing / until we find a configured key.
		let mut remain = path;

		while let Some((prefix, _)) = remain.rsplit_once("/") {
			if let Some(matches) = self.paths.get(prefix) {
				key = matches;
				break;
			}

			remain = prefix;
		}

		if let Some(token) = token {
			// If there's a token, make sure there's also a key configured.
			// We don't want to accidentally publish to an unauthorized path.
			let key = key.as_ref().context("no authentication configured")?;

			// Verify the token and return the payload.
			return key.verify(&token, path);
		}

		if key.is_some() {
			anyhow::bail!("token required");
		}

		// No auth required, so create a dummy token that allows accessing everything.
		Ok(moq_token::Payload {
			path: path.to_string(),
			publish: Some("".to_string()),
			subscribe: Some("".to_string()),
			..Default::default()
		})
	}
}
