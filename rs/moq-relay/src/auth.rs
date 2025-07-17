use std::sync::Arc;

use serde::{Deserialize, Serialize};
use url::Url;

#[derive(clap::Args, Clone, Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct AuthConfig {
	/// The root authentication key.
	/// If present, all paths will require a token unless they are in the public list.
	#[arg(long = "auth-key")]
	pub key: Option<String>,

	/// The prefix that will be public for reading and writing.
	/// If present, unauthorized users will be able to read and write to this prefix ONLY.
	/// If a user provides a token, then they can only access the prefix only if it is specified in the token.
	#[arg(long = "auth-public")]
	pub public: Option<String>,
}

impl AuthConfig {
	pub fn init(self) -> anyhow::Result<Auth> {
		Auth::new(self)
	}
}

#[derive(Clone)]
pub struct Auth {
	key: Option<Arc<moq_token::Key>>,
	public: Option<String>,
}

impl Auth {
	pub fn new(config: AuthConfig) -> anyhow::Result<Self> {
		let key = match config.key.as_deref() {
			Some(path) => Some(moq_token::Key::from_file(path)?),
			None => {
				tracing::warn!("no root key configured; all paths will be public");
				None
			}
		};

		Ok(Self {
			key: key.map(Arc::new),
			public: config.public,
		})
	}

	// Parse the token from the user provided URL, returning the claims if successful.
	// If no token is provided, then the claims will use the public path if it is set.
	pub fn verify(&self, url: &Url) -> anyhow::Result<moq_token::Claims> {
		// Find the token in the query parameters.
		// ?jwt=...
		if let Some((_, token)) = url.query_pairs().find(|(k, _)| k == "jwt") {
			if let Some(key) = self.key.as_ref() {
				return Ok(key.decode(&token)?);
			}

			anyhow::bail!("token provided, but no key configured");
		}

		let path = url.path().strip_prefix('/').unwrap_or_default();
		if !path.is_empty() {
			// TODO Remove this in a future version.
			tracing::warn!("BREAKING CHANGE: The URL path is no longer used to (potentially) select a broadcast. Use the `broadcast` parameter instead. Sorry for the inconvenience, but now it's much easier to debug.");
			anyhow::bail!("path is not empty: {}", path);
		}

		if let Some(public) = &self.public {
			return Ok(moq_token::Claims {
				root: public.clone(),
				subscribe: Some("".to_string()),
				publish: Some("".to_string()),
				..Default::default()
			});
		}

		anyhow::bail!("no token provided and no public path configured");
	}
}
