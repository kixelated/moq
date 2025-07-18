use std::sync::Arc;

use moq_lite::Path;
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
	pub public: Option<Path>,
}

impl AuthConfig {
	pub fn init(self) -> anyhow::Result<Auth> {
		Auth::new(self)
	}
}

#[derive(Clone)]
pub struct Auth {
	key: Option<Arc<moq_token::Key>>,
	public: Option<Path>,
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

		let public = config.public;

		Ok(Self {
			key: key.map(Arc::new),
			public,
		})
	}

	// Parse the token from the user provided URL, returning the claims if successful.
	// If no token is provided, then the claims will use the public path if it is set.
	pub fn verify(&self, url: &Url) -> anyhow::Result<moq_token::Claims> {
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
				root: public.clone(),
				subscribe: Some(Path::new("")),
				publish: Some(Path::new("")),
				..Default::default()
			}
		} else {
			anyhow::bail!("no token provided and no public path configured");
		};

		// Get the path from the URL, removing any leading or trailing slashes.
		// We will automatically add a trailing slash when joining the path with the subscribe/publish roots.
		let path = Path::new(url.path());

		// TODO We might be able to support when the path is more specific than the claim.
		// But it's not worth the mental overhead right now.
		anyhow::ensure!(
			claims.root == path,
			"path does not match the root: {} != {}",
			path,
			claims.root
		);

		Ok(claims)
	}
}
