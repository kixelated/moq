use anyhow::Context;
use hang::cmaf::Import;
use hang::moq_lite;
use tokio::io::AsyncRead;
use url::Url;

pub async fn client<T: AsyncRead + Unpin>(
	config: moq_native::ClientConfig,
	url: Url,
	name: String,
	input: &mut T,
) -> anyhow::Result<()> {
	let broadcast = moq_lite::Broadcast::produce();
	let client = config.init()?;

	// Connect to the remote and start parsing stdin in parallel.
	tokio::select! {
		res = connect(client, url, name, broadcast.consumer) => res,
		res = publish(broadcast.producer, input) => res,
	}
}

async fn connect(
	client: moq_native::Client,
	url: Url,
	name: String,
	consumer: moq_lite::BroadcastConsumer,
) -> anyhow::Result<()> {
	tracing::info!(%url, %name, "connecting");

	let session = client.connect(url).await?;

	// Create an origin producer to publish to the broadcast.
	let origin = moq_lite::Origin::produce();
	origin.producer.publish_broadcast(&name, consumer);

	// Establish the connection, not providing a subscriber.
	let session = moq_lite::Session::connect(session, origin.consumer, None).await?;

	tokio::select! {
		// On ctrl-c, close the session and exit.
		_ = tokio::signal::ctrl_c() => {
			session.close(moq_lite::Error::Cancel);

			// Give it a chance to close.
			tokio::time::sleep(std::time::Duration::from_millis(100)).await;

			Ok(())
		}
		// Otherwise wait for the session to close.
		_ = session.closed() => Err(session.closed().await.into()),
	}
}

async fn publish<T: AsyncRead + Unpin>(producer: moq_lite::BroadcastProducer, input: &mut T) -> anyhow::Result<()> {
	let mut import = Import::new(producer);

	import
		.init_from(input)
		.await
		.context("failed to initialize cmaf from input")?;

	tracing::info!("initialized");

	import.read_from(input).await?;

	Ok(())
}
