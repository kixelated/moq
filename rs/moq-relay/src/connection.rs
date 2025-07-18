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

		// These broadcasts will be served to the session (when it subscribes).
		let mut publish = None;
		if let Some(prefix) = token.subscribe {
			let prefix = format!("{}{}", token.root, prefix);
			publish = Some(match token.cluster {
				true => self.cluster.primary.consume_prefix(&prefix),
				false => self.cluster.combined.consume_prefix(&prefix),
			});
		}

		// These broadcasts will be received from the session (when it publishes).
		let mut subscribe = None;
		if let Some(prefix) = token.publish {
			// If this is a cluster node, then add its broadcasts to the secondary origin.
			// That way we won't publish them to other cluster nodes.
			let prefix = format!("{}{}", token.root, prefix);
			subscribe = Some(match token.cluster {
				true => self.cluster.secondary.publish_prefix(&prefix),
				false => self.cluster.primary.publish_prefix(&prefix),
			});
		}

		let session = moq_lite::Session::accept(self.session.clone(), publish, subscribe).await?;

		// Wait until the session is closed.
		Err(session.closed().await.into())
	}
}
