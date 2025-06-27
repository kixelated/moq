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

			// If the path ends with a /, then this is a folder and is treated as a prefix.
			let primary = if full.is_empty() || full.ends_with("/") {
				self.cluster.primary.consume_prefix(&full)
			} else {
				// Otherwise this is a specific broadcast.
				self.cluster.primary.consume_exact(&full)
			};

			session.publish_prefix(&subscribe, primary);

			// Only publish primary broadcasts if the client is a cluster node.
			if !self.token.subscribe_primary {
				// TODO prefer primary broadcasts if there's a tie?
				let secondary = if full.is_empty() || full.ends_with("/") {
					self.cluster.secondary.consume_prefix(&full)
				} else {
					self.cluster.secondary.consume_exact(&full)
				};

				session.publish_prefix(&subscribe, secondary);
			}
		}

		// Publish all broadcasts produced by the session to the local origin.
		// TODO These need to be published to remotes if it's a relay.
		if let Some(publish) = self.token.publish {
			let full = format!("{}{}", self.token.path, publish);
			let cluster = match self.token.publish_secondary {
				true => &mut self.cluster.secondary,
				false => &mut self.cluster.primary,
			};

			if full.is_empty() || full.ends_with("/") {
				let produced = session.consume_prefix(&publish);
				cluster.publish_prefix(&full, produced);
			} else {
				let produced = session.consume_exact(&publish);
				cluster.publish_prefix(&full, produced);
			}
		}

		// Wait until the session is closed.
		let err = session.closed().await;

		tracing::info!(?err, "connection terminated");
	}
}
