use url::Url;

use anyhow::Context;
use clap::Parser;

mod clock;
use moq_lite::*;

#[derive(Parser, Clone)]
pub struct Config {
	/// Connect to the given URL starting with https://
	#[arg(long)]
	pub url: Url,

	/// The name of the broadcast to publish or subscribe to.
	#[arg(long)]
	pub broadcast: String,

	/// The MoQ client configuration.
	#[command(flatten)]
	pub client: moq_native::ClientConfig,

	/// The name of the clock track.
	#[arg(long, default_value = "seconds")]
	pub track: String,

	/// The log configuration.
	#[command(flatten)]
	pub log: moq_native::Log,

	/// Whether to publish the clock or consume it.
	#[command(subcommand)]
	pub role: Command,
}

#[derive(Parser, Clone)]
pub enum Command {
	Publish,
	Subscribe,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
	let config = Config::parse();
	config.log.init();

	let client = config.client.init()?;

	tracing::info!(url = ?config.url, "connecting to server");

	let session = client.connect(config.url).await?;

	let track = Track {
		name: config.track,
		priority: 0,
	};

	match config.role {
		Command::Publish => {
			let mut broadcast = BroadcastProducer::new();
			let track = broadcast.create(track);
			let clock = clock::Publisher::new(track);

			let mut publisher = moq_lite::OriginProducer::default();
			publisher.publish(&config.broadcast, broadcast.consume());

			let session = moq_lite::Session::connect(session, publisher.consume_all(), None).await?;

			tokio::select! {
				res = session.closed() => Err(res.into()),
				_ = clock.run() => Ok(()),
			}
		}
		Command::Subscribe => {
			let origin = moq_lite::OriginProducer::default();
			let session = moq_lite::Session::connect(session, None, origin.clone()).await?;

			// The broadcast name is empty because the URL contains the name
			let broadcast = origin.consume(&config.broadcast).context("broadcast not found")?;
			let track = broadcast.subscribe(&track);
			let clock = clock::Subscriber::new(track);

			tokio::select! {
				res = session.closed() => Err(res.into()),
				_ = clock.run() => Ok(()),
			}
		}
	}
}
