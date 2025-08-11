use std::{collections::HashMap, path::PathBuf};

use anyhow::Context;
use moq_lite::{Broadcast, BroadcastConsumer, BroadcastProducer, Origin, OriginConsumer, OriginProducer};
use tracing::Instrument;
use url::Url;

#[serde_with::serde_as]
#[derive(clap::Args, Clone, Debug, serde::Serialize, serde::Deserialize, Default)]
#[serde_with::skip_serializing_none]
#[serde(default, deny_unknown_fields)]
pub struct ClusterConfig {
	/// Connect to this hostname in order to discover other nodes.
	#[arg(long = "cluster-connect", env = "MOQ_CLUSTER_CONNECT")]
	pub connect: Option<String>,

	/// Use the token in this file when connecting to other nodes.
	#[arg(long = "cluster-token", env = "MOQ_CLUSTER_TOKEN")]
	pub token: Option<PathBuf>,

	/// Our hostname which we advertise to other nodes.
	#[arg(long = "cluster-advertise", env = "MOQ_CLUSTER_ADVERTISE")]
	pub advertise: Option<String>,

	/// The prefix to use for cluster announcements.
	/// Defaults to "internal/origins".
	///
	/// WARNING: This should not be accessible by users unless authentication is disabled (YOLO).
	#[arg(
		long = "cluster-prefix",
		default_value = "internal/origins",
		env = "MOQ_CLUSTER_PREFIX"
	)]
	pub prefix: moq_lite::PathOwned,
}

#[derive(Clone)]
pub struct Cluster {
	config: ClusterConfig,
	client: moq_native::Client,

	// Advertises ourselves as an origin to other nodes.
	noop: moq_lite::Produce<BroadcastProducer, BroadcastConsumer>,

	// Broadcasts announced by local clients (users).
	pub primary: moq_lite::Produce<OriginProducer, OriginConsumer>,

	// Broadcasts announced by remote servers (cluster).
	pub secondary: moq_lite::Produce<OriginProducer, OriginConsumer>,

	// Broadcasts announced by local clients and remote servers.
	pub combined: moq_lite::Produce<OriginProducer, OriginConsumer>,
}

impl Cluster {
	pub fn new(config: ClusterConfig, client: moq_native::Client) -> Self {
		Cluster {
			config,
			client,
			primary: Origin::produce(),
			noop: Broadcast::produce(),
			secondary: Origin::produce(),
			combined: Origin::produce(),
		}
	}

	pub fn get(&self, broadcast: &str) -> Option<BroadcastConsumer> {
		self.primary
			.consumer
			.consume_broadcast(broadcast)
			.or_else(|| self.secondary.consumer.consume_broadcast(broadcast))
	}

	pub async fn run(mut self) -> anyhow::Result<()> {
		let connect = match self.config.connect.clone() {
			// If we're using a root node, then we have to connect to it.
			Some(connect) if Some(&connect) != self.config.advertise.as_ref() => connect,
			// Otherwise, we're the root node so we wait for other nodes to connect to us.
			_ => {
				tracing::info!("running as root, accepting leaf nodes");
				return self.run_combined().await;
			}
		};

		// Announce ourselves as an origin to the root node.
		if let Some(myself) = self.config.advertise.as_ref() {
			tracing::info!(%self.config.prefix, %myself, "announcing as leaf");
			let name = self.config.prefix.join(myself);
			self.primary
				.producer
				.publish_broadcast(&name, self.noop.consumer.clone());
		}

		// If the token is provided, read it from the disk and use it in the query parameter.
		// TODO put this in an AUTH header once WebTransport supports it.
		let token = match &self.config.token {
			Some(path) => std::fs::read_to_string(path).context("failed to read token")?,
			None => "".to_string(),
		};

		let noop = self.noop.consumer.clone();

		tokio::select! {
			res = self.clone().run_remote(&connect, token.clone(), noop) => res.context("failed to connect to root"),
			res = self.clone().run_remotes(token) => res.context("failed to connect to remotes"),
			res = self.run_combined() => res.context("failed to run combined"),
		}
	}

	// Shovel broadcasts from the primary and secondary origins into the combined origin.
	async fn run_combined(mut self) -> anyhow::Result<()> {
		let mut primary = self.primary.consumer.clone();
		let mut secondary = self.secondary.consumer.clone();

		loop {
			let (name, broadcast) = tokio::select! {
				biased;
				Some(primary) = primary.announced() => primary,
				Some(secondary) = secondary.announced() => secondary,
				else => return Ok(()),
			};

			if let Some(broadcast) = broadcast {
				self.combined.producer.publish_broadcast(&name, broadcast);
			}
		}
	}

	async fn run_remotes(self, token: String) -> anyhow::Result<()> {
		// Subscribe to available origins.
		let mut origins = self
			.secondary
			.consumer
			.consume_only(&[self.config.prefix.borrow()])
			.context("no authorized origins")?;

		// Cancel tasks when the origin is closed.
		let mut active: HashMap<String, tokio::task::AbortHandle> = HashMap::new();

		// Discover other origins.
		// NOTE: The root node will connect to all other nodes as a client, ignoring the existing (server) connection.
		// This ensures that nodes are advertising a valid hostname before any tracks get announced.
		while let Some((node, origin)) = origins.try_announced() {
			if Some(node.as_str()) == self.config.advertise.as_deref() {
				// Skip ourselves.
				continue;
			}

			let origin = match origin {
				Some(origin) => origin,
				None => {
					tracing::info!(%node, "origin cancelled");
					active.remove(node.as_str()).unwrap().abort();
					continue;
				}
			};

			tracing::info!(%node, "discovered origin");

			let this = self.clone();
			let token = token.clone();
			let node2 = node.clone();

			let handle = tokio::spawn(
				async move {
					match this.run_remote(node2.as_str(), token, origin).await {
						Ok(()) => tracing::info!(%node2, "origin closed"),
						Err(err) => tracing::warn!(%err, %node2, "origin error"),
					}
				}
				.in_current_span(),
			);

			active.insert(node.to_string(), handle.abort_handle());
		}

		Ok(())
	}

	#[tracing::instrument("remote", skip_all, err, fields(%node))]
	async fn run_remote(mut self, node: &str, token: String, origin: BroadcastConsumer) -> anyhow::Result<()> {
		let url = Url::parse(&format!("https://{node}/?jwt={token}"))?;
		let mut backoff = 1;

		loop {
			let res = tokio::select! {
				biased;
				_ = origin.closed() => break,
				res = self.run_remote_once(&url) => res,
			};

			if let Err(err) = res {
				backoff *= 2;
				tracing::error!(%err, "remote error");
			}

			let timeout = tokio::time::Duration::from_secs(backoff);
			if timeout > tokio::time::Duration::from_secs(300) {
				// 5 minutes of backoff is enough, just give up.
				// TODO Reset the backoff if the connect is successful for some period of time.
				anyhow::bail!("remote connection keep failing, giving up");
			}

			tokio::time::sleep(timeout).await;
		}

		Ok(())
	}

	async fn run_remote_once(&mut self, url: &Url) -> anyhow::Result<()> {
		tracing::info!(%url, "connecting to remote");

		// Connect to the remote node.
		let conn = self
			.client
			.connect(url.clone())
			.await
			.context("failed to connect to remote")?;

		let publish = Some(self.primary.consumer.clone());
		let subscribe = Some(self.secondary.producer.clone());

		let session = moq_lite::Session::connect(conn, publish, subscribe)
			.await
			.context("failed to establish session")?;

		Err(session.closed().await.into())
	}
}
