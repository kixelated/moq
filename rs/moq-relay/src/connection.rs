use crate::Cluster;

pub struct Connection {
	pub id: u64,
	pub session: web_transport::Session,
	pub cluster: Cluster,
	pub token: moq_token::Payload,
}

impl Connection {
	#[tracing::instrument("conn", skip_all, fields(id = self.id, path = %self.token.path))]
	pub async fn run(mut self) {
		let mut session = match moq_lite::Session::accept(self.session).await {
			Ok(session) => session,
			Err(err) => {
				tracing::warn!(?err, "failed to accept session");
				return;
			}
		};

		// Publish all primary and secondary broadcasts to the session.
		if let Some(subscribe) = self.token.subscribe {
			let full = format!("{}{}", self.token.path, subscribe);

			let primary = self.cluster.primary.consume_prefix(&full);
			session.publish_prefix(&subscribe, primary);

			// Only publish primary broadcasts if the client is a cluster node.
			if !self.token.subscribe_primary {
				// TODO prefer primary broadcasts if there's a tie?
				let secondary = self.cluster.secondary.consume_prefix(&full);
				session.publish_prefix(&subscribe, secondary);
			}
		}

		// Publish all broadcasts produced by the session to the local origin.
		// TODO These need to be published to remotes if it's a relay.
		if let Some(publish) = self.token.publish {
			let produced = session.consume_prefix(&publish);

			let full = format!("{}{}", self.token.path, publish);

			// If we're a secondary, then we only publish to the secondary cluster.
			if self.token.publish_secondary {
				self.cluster.secondary.publish_prefix(&full, produced);
			} else {
				self.cluster.primary.publish_prefix(&full, produced);
			}
		}

		// Publish this specific broadcast if it's being forced.
		// This is useful to avoid a secret participant in a call, only subscribing but not publishing.
		// It also avoids an RTT when the user joins a call I guess.
		if let Some(publish_force) = self.token.publish_force {
			let produced = session.consume(&publish_force);
			let full = format!("{}{}", self.token.path, publish_force);
			self.cluster.primary.publish(&full, produced);
		}

		// Wait until the session is closed.
		let err = session.closed().await;

		tracing::info!(?err, "connection terminated");
	}
}
