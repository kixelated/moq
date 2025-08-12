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
		// If this is a cluster node, then only publish our primary broadcasts.
		// Otherwise publish everything.
		let subscribe_origin = match token.cluster {
			true => &self.cluster.primary,
			false => &self.cluster.combined,
		};

		// Scope the origin to our root.
		let subscribe_origin = subscribe_origin.producer.with_root(&token.root).unwrap();
		let subscribe = subscribe_origin.consume_only(&token.subscribe);

		// If this is a cluster node, then add its broadcasts to the secondary origin.
		// That way we won't publish them to other cluster nodes.
		let publish_origin = match token.cluster {
			true => &self.cluster.secondary,
			false => &self.cluster.primary,
		};

		let publish_origin = publish_origin.producer.with_root(&token.root).unwrap();
		let publish = publish_origin.publish_only(&token.publish);

		match (&subscribe, &publish) {
			(Some(subscribe), Some(publish)) => {
				tracing::info!(root = %token.root, subscribe = %subscribe.allowed().map(|p| p.as_str()).collect::<Vec<_>>().join(","), publish = %publish.allowed().map(|p| p.as_str()).collect::<Vec<_>>().join(","), "session accepted");
			}
			(Some(subscribe), None) => {
				tracing::info!(root = %token.root, subscribe = %subscribe.allowed().map(|p| p.as_str()).collect::<Vec<_>>().join(","), "subscriber accepted");
			}
			(None, Some(publish)) => {
				tracing::info!(root = %token.root, publish = %publish.allowed().map(|p| p.as_str()).collect::<Vec<_>>().join(","), "publisher accepted")
			}
			_ => anyhow::bail!("invalid session; no allowed paths"),
		}

		// NOTE: subscribe and publish seem backwards because of how relays work.
		// We publish the tracks the client is allowed to subscribe to.
		// We subscribe to the tracks the client is allowed to publish.
		let session = moq_lite::Session::accept(session, subscribe, publish).await?;

		// Wait until the session is closed.
		Err(session.closed().await.into())
	}
}
