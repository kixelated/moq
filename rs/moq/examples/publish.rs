use anyhow::Context;
use clap::Parser;
use moq_lite::{BroadcastProducer, OriginProducer, Session, Track};
use serde_json::json;
use std::time::Duration;
use url::Url;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
	/// Some logging settings.
	#[command(flatten)]
	log: moq_native::Log,

	/// The MoQ client configuration, contiaining useful QUIC settings.
	#[command(flatten)]
	quic: moq_native::ClientConfig,

	/// The MoQ relay URL to connect to
	#[arg(env = "MOQ_URL")]
	url: String,

	/// The broadcast name to publish
	#[arg(env = "MOQ_NAME")]
	name: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
	// Parse command line arguments
	let args = Args::parse();
	args.log.init();

	let url = Url::parse(&args.url).context("Invalid URL")?;

	// Create a QUIC client.
	let client = args.quic.init()?;

	// Connect to the relay
	tracing::info!("Connecting to relay: {}", url);
	let session = client.connect(url).await.context("Failed to connect")?;
	tracing::info!("✅ Connected to relay");

	// Create a broadcast producer
	let mut broadcast_producer = BroadcastProducer::new();

	// Create an origin producer to publish to the broadcast
	let mut origin_producer = OriginProducer::default();
	origin_producer.publish(&args.name, broadcast_producer.consume());

	// Establish the session (no subscriber)
	let session = Session::connect(session, origin_producer.consume_all(), None)
		.await
		.context("Failed to establish session")?;

	tracing::info!("✅ Published broadcast: {}", args.name);

	// Create a "clock" track within our broadcast
	let track = Track::new("clock");
	let mut track_producer = broadcast_producer.create(track);

	tracing::info!("✅ Publishing the current time");

	// Send the current timestamp over the wire as a test
	let mut now = std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.unwrap()
		.as_secs();

	loop {
		// Create a JSON message just because it's easy
		let json_msg = json!({ "now": now });
		let data = json_msg.to_string().into_bytes();

		// Create a new group for each frame
		let mut group = track_producer.append_group();
		group.write_frame(data);
		group.finish();

		// Sleep for a second
		tokio::select! {
			_ = tokio::time::sleep(Duration::from_secs(1)) => {},
			res = session.closed() => return Err(res.into()),
		};

		now += 1; // Add 1 second
	}
}
