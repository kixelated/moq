use tokio::sync::broadcast;
use url::Url;

use anyhow::Context;
use clap::Parser;

mod gamecontroller;
use moq_lite::*;


/// Based on moq-clock
#[derive(Parser,Clone)]
pub struct Config {
	#[arg()]
	pub url: Url,

	/// The name of the broadcast to publish or subscribe to.
	#[arg(long, default_value = "controller")]
	pub broadcast: String,

	#[command(flatten)]
	pub client: moq_native::ClientConfig,

	/// The default name for the track
	#[arg(long, default_value = "seconds")]
	pub track: String,

	/// The log configuration
	#[command(flatten)]
	pub log: moq_native::Log,

}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
	let config = Config::parse();
	config.log.init();

	let client: moq_native::Client = config.client.init()?;
	tracing::info!(url = ?config.url, "[moq-gamecontroller] Connecting to server...\n");
	println!("[moq-gamecontroller] Connecting to server...\n");

	let session = client.connect(config.url).await?;
	//let origin = moq_lite::OriginProducer::default();
	let origin = moq_lite::Origin::produce();
	//let session = moq_lite::Session::connect(session, None, origin.clone()).await?;
	let session = moq_lite::Session::connect(session, None, Some(origin.producer)).await?;

	let track = Track { name: config.track, priority: 0, };
	println!("[moq-gamecontroller] Track: {}", track.name);

	//let broadcast = session.consume("");
	//let broadcast = origin.consume(&config.broadcast).context("[moq-gamecontroller] broadcast not found")?;
	let broadcast = origin.consumer.consume_broadcast(&config.broadcast).context("[moq-gamecontroller] broadcast not found")?;
	let track = broadcast.subscribe_track(&track);
	println!("[moq-gamecontroller] Creating a new Receiver:");
	let receiver = gamecontroller::Receiver::new(track);

	tokio::select! {
		res = session.closed() => Err(res.into()),
		_ = receiver.run() => Ok(()),
	}

}
