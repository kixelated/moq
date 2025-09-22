// cargo run --example video
use moq_lite::coding::Bytes;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
	// Optional: Use moq_native to configure a logger.
	moq_native::Log {
		level: tracing::Level::DEBUG,
	}
	.init();

	// Create an origin that we can publish to and the session can consume from.
	let origin = moq_lite::Origin::produce();

	// Run the broadcast production and the session in parallel.
	// This is a simple example of how you can concurrently run multiple tasks.
	// tokio::spawn works too.
	tokio::select! {
		res = run_broadcast(origin.producer) => res,
		res = run_session(origin.consumer) => res,
	}
}

// Connect to the server and publish our origin of broadcasts.
async fn run_session(origin: moq_lite::OriginConsumer) -> anyhow::Result<()> {
	// Optional: Use moq_native to make a QUIC client.
	let config = moq_native::ClientConfig::default();
	let client = moq_native::Client::new(config)?;

	// For local development, use: http://localhost:4443/anon
	// The "anon" path is usually configured to bypass authentication; be careful!
	let url = url::Url::parse("https://relay.moq.dev/anon/video-example").unwrap();

	// Establish a WebTransport/QUIC connection.
	let connection = client.connect(url).await?;

	// Perform the MoQ handshake.
	// None means we're not consuming anything from the session, otherwise we would provide an OriginProducer.
	let session = moq_lite::Session::connect(connection, origin, None).await?;

	// Wait until the session is closed.
	Err(session.closed().await.into())
}

// Create a video track with a catalog that describes it.
// The catalog can contain multiple tracks, used by the viewer to choose the best track.
fn create_track(broadcast: &mut moq_lite::BroadcastProducer) -> hang::TrackProducer {
	// Basic information about the video track.
	let video_track = moq_lite::Track {
		name: "video".to_string(),
		priority: 1, // Video typically has lower priority than audio
	};

	// Example catalog configuration
	// In a real application, you would get this from the encoder
	let video = hang::catalog::Video {
		// Tell the viewer about the video track we're producing.
		track: video_track.clone(),
		config: hang::catalog::VideoConfig {
			codec: hang::catalog::H264 {
				profile: 0x4D, // Main profile
				constraints: 0,
				level: 0x28, // Level 4.0
			}
			.into(),
			optional: hang::catalog::VideoConfigOptional {
				// Codec-specific data (e.g., SPS/PPS for H.264)
				// Not needed if you're using annex.b
				description: None,
				// There are optional but good to have.
				coded_width: Some(1920),
				coded_height: Some(1080),
				bitrate: Some(5_000_000), // 5 Mbps
				framerate: Some(30.0),
				..Default::default()
			},
		},
	};

	// Create a producer/consumer pair for the catalog.
	// This JSON encodes the catalog as a "catalog.json" track.
	let catalog = hang::catalog::Root {
		video: vec![video],
		..Default::default()
	}
	.produce();

	// Publish the catalog track to the broadcast.
	broadcast.insert_track(catalog.consumer.track);

	// Actually create the media track now.
	let track = broadcast.create_track(video_track);

	// Wrap the track in a hang:TrackProducer for convenience methods.
	track.into()
}

// Produce a broadcast and publish it to the origin.
async fn run_broadcast(origin: moq_lite::OriginProducer) -> anyhow::Result<()> {
	// Create and publish a broadcast to the origin.
	let mut broadcast = moq_lite::Broadcast::produce();
	let mut track = create_track(&mut broadcast.producer);

	// NOTE: The path is empty because we're using the URL to scope the broadcast.
	// OPTIONAL: We publish after inserting the tracks just to avoid a nearly impossible race condition.
	origin.publish_broadcast("", broadcast.consumer);

	// Not real frames of course.
	track.write(hang::Frame {
		keyframe: true,
		timestamp: std::time::Duration::from_secs(1),
		payload: Bytes::from_static(b"keyframe NAL data"),
	});

	tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

	track.write(hang::Frame {
		keyframe: false,
		timestamp: std::time::Duration::from_secs(2),
		payload: Bytes::from_static(b"delta NAL data"),
	});

	tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

	// Automatically creates a new group if you write a new keyframe.

	track.write(hang::Frame {
		keyframe: true,
		timestamp: std::time::Duration::from_secs(3),
		payload: Bytes::from_static(b"keyframe NAL data"),
	});

	// Sleep before exiting and closing the broadcast.
	tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;

	Ok(())
}
