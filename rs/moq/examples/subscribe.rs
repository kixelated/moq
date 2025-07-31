use anyhow::Context;
use clap::Parser;
use std::time::Duration;
use tokio::time::timeout;
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

	/// The broadcast name to subscribe to
	#[arg(env = "MOQ_NAME")]
	name: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
	// Parse command line arguments
	let args = Args::parse();
	args.log.init();

	let url = Url::parse(&args.url).context("Invalid URL")?;

	// Create client configuration
	let client = args.quic.init()?;

	// Connect to the relay
	tracing::info!("Connecting to relay: {}", url);
	let session = client.connect(url).await.context("Failed to connect")?;
	tracing::info!("✅ Connected to relay");

	// Create an origin producer to receive broadcasts
	let mut origin = moq_lite::Origin::default().produce();

	// Establish the session (with a subscriber)
	let session = moq_lite::Session::connect(session, None, Some(origin.producer))
		.await
		.context("Failed to establish session")?;

	// Optionally wait for the broadcast to be announced
	tracing::info!("🔍 Waiting for announce: {}", args.name);

	// Start a 1 second timeout because announcements are technically not required
	let announce_result = timeout(Duration::from_secs(1), async {
		while let Some(update) = origin.consumer.announced().await {
			if update.suffix.as_str() == args.name && update.active.is_some() {
				return Some(update);
			}
		}
		None
	})
	.await;

	match announce_result {
		Ok(Some(announce)) => {
			tracing::info!("🎉 Announced: {}", announce.suffix);
		}
		_ => {
			tracing::warn!("⚠️ No announce found after 1 second, subscribing anyway...");
		}
	}

	// Subscribe to the broadcast
	let broadcast = origin
		.consumer
		.get(&args.name)
		.context("Broadcast not found")?;
	let track = moq_lite::Track::new("clock");
	let mut track_consumer = broadcast.subscribe(&track);

	loop {
		// Wait for the next group to be available.
		// NOTE: Groups may arrive out of order and in parallel.
		// This crude example reads sequentially, but a proper application should handle this.
		let mut group = tokio::select! {
			res = track_consumer.next() => match res? {
				Some(group) => group,
				None => {
					// The producer can close the track at any time without an error.
					tracing::warn!("⚠️ Track has ended");
					break;
				}
			},
			err = session.closed() => return Err(err.into()),
		};

		// Wait for the next frame within the group to be available.
		// NOTE: In this example there will only be one frame per group.
		// For JSON blobs this is a good idea because messages are independent.
		// But for something delta encoded like video frames, you want frames to be in dependency order.
		let frame = tokio::select! {
			res = group.read() => match res? {
				Some(frame) => frame,
				None => {
					// Our example won't do this, but it is legal to produce empty groups.
					tracing::warn!("⚠️ Empty group");
					continue;
				}
			},
			err = session.closed() => return Err(err.into()),
		};

		let message = String::from_utf8_lossy(&frame);
		tracing::info!("🎉 Got group {} message: {}", group.info.sequence, message);

		// Optional sanity testing
		if (group.read().await?).is_some() {
			tracing::warn!("⚠️ Group should only have one frame");
		}
	}

	Ok(())
}
