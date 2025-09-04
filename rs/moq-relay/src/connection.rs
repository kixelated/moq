use crate::{Auth, Cluster};

use moq_native::web_transport_quinn;

pub struct Connection {
	pub id: u64,
	pub request: web_transport_quinn::Request,
	pub cluster: Cluster,
	pub auth: Auth,
}

impl Connection {
	#[tracing::instrument("conn", skip_all, fields(id = self.id))]
	pub async fn run(self) -> anyhow::Result<()> {
		// Extract the path and token from the URL.
		let path = self.request.url().path();
		let token = self
			.request
			.url()
			.query_pairs()
			.find(|(k, _)| k == "jwt")
			.map(|(_, v)| v.to_string());

		// Verify the URL before accepting the connection.
		let token = match self.auth.verify(path, token.as_deref()) {
			Ok(token) => token,
			Err(err) => {
				let _ = self.request.close(err.clone().into()).await;
				return Err(err.into());
			}
		};

		let publish = self.cluster.publisher(&token);
		let subscribe = self.cluster.subscriber(&token);

		match (&publish, &subscribe) {
			(Some(publish), Some(subscribe)) => {
				tracing::info!(root = %token.root, publish = %publish.allowed().map(|p| p.as_str()).collect::<Vec<_>>().join(","), subscribe = %subscribe.allowed().map(|p| p.as_str()).collect::<Vec<_>>().join(","), "session accepted");
			}
			(Some(publish), None) => {
				tracing::info!(root = %token.root, publish = %publish.allowed().map(|p| p.as_str()).collect::<Vec<_>>().join(","), "publisher accepted");
			}
			(None, Some(subscribe)) => {
				tracing::info!(root = %token.root, subscribe = %subscribe.allowed().map(|p| p.as_str()).collect::<Vec<_>>().join(","), "subscriber accepted")
			}
			_ => anyhow::bail!("invalid session; no allowed paths"),
		}

		// Accept the connection.
		let session = self.request.ok().await?;

		// NOTE: subscribe and publish seem backwards because of how relays work.
		// We publish the tracks the client is allowed to subscribe to.
		// We subscribe to the tracks the client is allowed to publish.
		let session = moq_lite::Session::accept(session, subscribe, publish).await?;

		// Wait until the session is closed.
		Err(session.closed().await.into())
	}
}
