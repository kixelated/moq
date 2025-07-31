use crate::{Auth, Cluster};

use web_transport::quinn::http;

pub struct Connection {
	pub id: u64,
	pub request: web_transport::quinn::Request,
	pub cluster: Cluster,
	pub auth: Auth,
}

impl Connection {
	#[tracing::instrument("conn", skip_all, fields(id = self.id))]
	pub async fn run(self) -> anyhow::Result<()> {
		// Verify the URL before accepting the connection.
		let token = match self.auth.verify(self.request.url()) {
			Ok(token) => token,
			Err(err) => {
				self.request.close(http::StatusCode::UNAUTHORIZED).await?;
				return Err(err);
			}
		};

		// Accept the connection.
		let session = self.request.ok().await?;

		// These broadcasts will be served to the session (when it subscribes).
		let mut subscribe = None;
		if let Some(prefix) = &token.subscribe {
			// If this is a cluster node, then only publish our primary broadcasts.
			// Otherwise publish everything.
			let origin = match token.cluster {
				true => &self.cluster.primary,
				false => &self.cluster.combined,
			};

			// Scope the origin to our root.
			let origin = origin.producer.with_root(&token.root);
			subscribe = Some(origin.consume_prefix(prefix));
		}

		// These broadcasts will be received from the session (when it publishes).
		let mut publish = None;
		if let Some(prefix) = &token.publish {
			// If this is a cluster node, then add its broadcasts to the secondary origin.
			// That way we won't publish them to other cluster nodes.
			let origin = match token.cluster {
				true => &self.cluster.secondary,
				false => &self.cluster.primary,
			};

			let origin = origin.producer.with_root(&token.root);
			publish = Some(origin.with_prefix(prefix))
		}

		tracing::info!(root = %token.root, subscribe = %subscribe.as_ref().map(|s| s.prefix().as_str()).unwrap_or("(none)"), publish = %publish.as_ref().map(|p| p.prefix().as_str()).unwrap_or("(none)"), "session accepted");

		// NOTE: subscribe and publish seem backwards because of how relays work.
		// We publish the tracks the client is allowed to subscribe to.
		// We subscribe to the tracks the client is allowed to publish.
		let session = moq_lite::Session::accept(session, subscribe, publish).await?;

		// Wait until the session is closed.
		Err(session.closed().await.into())
	}
}
