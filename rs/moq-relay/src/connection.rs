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
	pub async fn run(mut self) -> anyhow::Result<()> {
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
			let prefix = token.root.join(prefix);

			subscribe = Some(match token.cluster {
				true => self.cluster.primary.consume_prefix(&prefix),
				false => self.cluster.combined.consume_prefix(&prefix),
			});
		}

		// These broadcasts will be received from the session (when it publishes).
		let mut publish = None;
		if let Some(prefix) = &token.publish {
			// If this is a cluster node, then add its broadcasts to the secondary origin.
			// That way we won't publish them to other cluster nodes.
			let prefix = token.root.join(prefix);

			publish = Some(match token.cluster {
				true => self.cluster.secondary.publish_prefix(&prefix),
				false => self.cluster.primary.publish_prefix(&prefix),
			});
		}

		tracing::info!(subscribe = ?subscribe.as_ref().map(|s| s.prefix()), publish = ?publish.as_ref().map(|p| p.prefix()), "session accepted");

		// NOTE: subscribe and publish seem backwards because of how relays work.
		// We publish the tracks the client is allowed to subscribe to.
		// We subscribe to the tracks the client is allowed to publish.
		let session = moq_lite::Session::accept(session, subscribe, publish).await?;

		// Wait until the session is closed.
		Err(session.closed().await.into())
	}
}
