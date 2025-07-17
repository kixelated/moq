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

		// Publish these broadcasts to the session.
		let mut publish = None;
		if let Some(prefix) = token.subscribe {
			let prefix = format!("{}{}", token.root, prefix);
			publish = Some(match token.cluster {
				true => self.cluster.primary.consume_prefix(&prefix),
				false => self.cluster.combined.consume_prefix(&prefix),
			});
		}

		// Consume these broadcasts from the session.
		let mut consume = None;
		if let Some(prefix) = token.publish {
			// If this is a cluster node, then add its broadcasts to the secondary origin.
			// That way we won't publish them to other cluster nodes.
			let prefix = format!("{}{}", token.root, prefix);
			consume = Some(match token.cluster {
				true => self.cluster.secondary.publish_prefix(&prefix),
				false => self.cluster.primary.publish_prefix(&prefix),
			});
		}

		let session = moq_lite::SessionOrigin::accept(self.session.clone(), consume, publish).await?;

		// Wait until the session is closed.
		Err(session.closed().await.into())
	}
}
