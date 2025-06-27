use std::{collections::HashMap, path::PathBuf};

use anyhow::Context;
use moq_lite::{BroadcastConsumer, BroadcastProducer, OriginProducer};
use tracing::Instrument;
use url::Url;

#[serde_with::serde_as]
#[derive(clap::Args, Clone, Debug, serde::Serialize, serde::Deserialize, Default)]
#[serde_with::skip_serializing_none]
#[serde(default, deny_unknown_fields)]
pub struct ClusterConfig {
	/// Connect to this hostname in order to discover other nodes.
	#[arg(long = "cluster-connect")]
	pub connect: Option<String>,

	/// Use the token in this file when connecting to other nodes.
	#[arg(long = "cluster-token")]
	pub token: Option<PathBuf>,

	/// Our hostname which we advertise to other nodes.
	#[arg(long = "cluster-advertise")]
	pub advertise: Option<String>,

	/// The prefix to use for cluster announcements.
	/// Defaults to "internal/origins".
	///
	/// WARNING: This should not be accessible by users unless authentication is disabled (YOLO).
	#[arg(long = "cluster-prefix", default_value = "internal/origins")]
	pub prefix: String,
}

#[derive(Clone)]
pub struct Cluster {
	config: ClusterConfig,
	client: moq_native::Client,

	// Tracks announced by local clients (users).
	pub primary: OriginProducer,

	// Tracks announced by remote servers (cluster).
	pub secondary: OriginProducer,
}

impl Cluster {
	pub fn new(config: ClusterConfig, client: moq_native::Client) -> Self {
		Cluster {
			config,
			client,
			primary: OriginProducer::new(),
			secondary: OriginProducer::new(),
		}
	}

	pub fn get(&self, broadcast: &str) -> Option<BroadcastConsumer> {
		self.primary
			.consume(broadcast)
			.or_else(|| self.secondary.consume(broadcast))
	}

	pub async fn run(self) -> anyhow::Result<()> {
		match self.config.connect.clone() {
			// If we're using a root node, then we have to connect to it.
			Some(connect) if Some(&connect) != self.config.advertise.as_ref() => self.run_leaf(connect).await,
			// Otherwise, we're the root node so we wait for other nodes to connect to us.
			_ => self.run_root().await,
		}
	}

	async fn run_leaf(mut self, root: String) -> anyhow::Result<()> {
		// Create a "broadcast" with no tracks to announce ourselves.
		let noop = BroadcastProducer::new();

		// If the token is provided, read it from the disk and use it in the query parameter.
		// TODO put this in an AUTH header once WebTransport supports it.
		let token = match &self.config.token {
			Some(path) => std::fs::read_to_string(path).context("failed to read token")?,
			None => "".to_string(),
		};

		// If we're a node, then we need to announce ourselves as an origin.
		// We do this by creating a "broadcast" with no tracks.
		let prefix = &self.config.prefix;

		tracing::info!(%prefix, %root, "connecting to root");

		let root = Url::parse(&format!("https://{}/?jwt={}", root, token)).context("invalid root URL")?;

		// Connect to the root node.
		let root = self.client.connect(root).await.context("failed to connect to root")?;

		let mut root = moq_lite::Session::connect(root)
			.await
			.context("failed to establish root session")?;

		// Announce ourselves as an origin to the root node.
		if let Some(myself) = self.config.advertise.as_ref() {
			tracing::info!(%prefix, %myself, "announcing as origin");
			let path = format!("{}/{}", prefix, myself);
			root.publish(path, noop.consume());
		}

		// Publish all of our primary broadcasts to the root.
		// There's no point in publishing secondary broadcasts because we form a mesh cluster.
		let primary = self.primary.consume_all();
		root.publish_all(primary);

		// Consume all of the remote broadcasts as secondary broadcasts.
		// If there's a tie, we'll still prefer our primary broadcasts.
		let remotes = root.consume_all();
		self.secondary.publish_all(remotes);

		// Subscribe to available origins.
		let mut origins = root.consume_prefix(format!("{}/", prefix));

		// Cancel tasks when the origin is closed.
		let mut active: HashMap<String, tokio::task::AbortHandle> = HashMap::new();

		// Discover other origins.
		// NOTE: The root node will connect to all other nodes as a client, ignoring the existing (server) connection.
		// This ensures that nodes are advertising a valid hostname before any tracks get announced.
		while let Some((node, origin)) = origins.next().await {
			if Some(&node) == self.config.advertise.as_ref() {
				// Skip ourselves.
				continue;
			}

			let origin = match origin {
				Some(origin) => origin,
				None => {
					tracing::info!(%node, "origin cancelled");
					active.remove(&node).unwrap().abort();
					continue;
				}
			};

			tracing::info!(%node, "discovered origin");

			let this = self.clone();
			let token = token.clone();
			let node2 = node.clone();

			let handle = tokio::spawn(
				async move {
					match this.run_remote(&node2, token, origin).await {
						Ok(()) => tracing::info!(%node2, "origin closed"),
						Err(err) => tracing::warn!(?err, %node2, "origin error"),
					}
				}
				.in_current_span(),
			);

			active.insert(node, handle.abort_handle());
		}

		Ok(())
	}

	async fn run_root(self) -> anyhow::Result<()> {
		tracing::info!("running as root, accepting leaf nodes");

		// Literally nothing to do here, because it's handled when accepting connections.

		Ok(())
	}

	#[tracing::instrument("remote", skip_all, err, fields(%node))]
	async fn run_remote(mut self, node: &str, token: String, origin: BroadcastConsumer) -> anyhow::Result<()> {
		let url = Url::parse(&format!("https://{}/{}", node, token))?;

		loop {
			let res = tokio::select! {
				biased;
				_ = origin.closed() => break,
				res = self.run_remote_once(&url) => res,
			};

			match res {
				Ok(()) => break,
				Err(err) => tracing::error!(?err, "remote error, retrying"),
			}

			// TODO smarter backoff
			tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
		}

		Ok(())
	}

	async fn run_remote_once(&mut self, url: &Url) -> anyhow::Result<()> {
		// Connect to the remote node.
		let conn = self
			.client
			.connect(url.clone())
			.await
			.context("failed to connect to remote")?;

		let mut session = moq_lite::Session::connect(conn)
			.await
			.context("failed to establish session")?;

		// Publish all of our primary broadcasts to the remote.
		// There's no point in publishing secondary broadcasts because we form a mesh cluster.
		let primary = self.primary.consume_all();
		session.publish_all(primary);

		// Consume all of the remote broadcasts as secondary broadcasts.
		// If there's a tie, we'll still prefer our primary broadcasts.
		let remotes = session.consume_all();
		self.secondary.publish_all(remotes);

		Err(session.closed().await.into())
	}
}
