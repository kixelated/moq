use crate::{Auth, Cluster};

pub struct Connection {
	pub id: u64,
	pub session: web_transport::Session,
	pub cluster: Cluster,
	pub auth: Auth,
}

impl Connection {
	#[tracing::instrument("conn", skip_all, fields(id = self.id))]
	pub async fn run(&mut self) -> anyhow::Result<()> {
		let token = self.auth.verify(self.session.url())?;
		let root = &token.root;

		// These broadcasts will be served to the session (when it subscribes).
		let mut publish = None;
		if let Some(prefix) = &token.publish {
			let prefix = root.join(prefix);

			publish = Some(match token.cluster {
				true => self.cluster.primary.consume_prefix(&prefix),
				false => self.cluster.combined.consume_prefix(&prefix),
			});
		}

		// These broadcasts will be received from the session (when it publishes).
		let mut subscribe = None;
		if let Some(prefix) = &token.subscribe {
			// If this is a cluster node, then add its broadcasts to the secondary origin.
			// That way we won't publish them to other cluster nodes.
			let prefix = root.join(prefix);

			subscribe = Some(match token.cluster {
				true => self.cluster.secondary.publish_prefix(&prefix),
				false => self.cluster.primary.publish_prefix(&prefix),
			});
		}

		tracing::info!(publish = ?publish.as_ref().map(|p| p.prefix()), subscribe = ?subscribe.as_ref().map(|s| s.prefix()), "session accepted");

		let session = moq_lite::Session::accept(self.session.clone(), publish, subscribe).await?;

		// Wait until the session is closed.
		Err(session.closed().await.into())
	}
}
