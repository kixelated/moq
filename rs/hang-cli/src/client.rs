use anyhow::Context;
use hang::cmaf::Import;
use hang::moq_lite;
use hang::{BroadcastConsumer, BroadcastProducer};
use tokio::io::AsyncRead;
use url::Url;

pub async fn client<T: AsyncRead + Unpin>(
	config: moq_native::ClientConfig,
	url: Url,
	broadcast: String,
	input: &mut T,
) -> anyhow::Result<()> {
	let producer = BroadcastProducer::new();
	let consumer = producer.consume();

	let client = config.init()?;

	// Connect to the remote and start parsing stdin in parallel.
	tokio::select! {
		res = connect(client, url, broadcast, consumer) => res,
		res = publish(producer, input) => res,
	}
}

async fn connect(
	client: moq_native::Client,
	url: Url,
	broadcast: String,
	consumer: BroadcastConsumer,
) -> anyhow::Result<()> {
	tracing::info!(%url, "connecting");

	let session = client.connect(url).await?;

	// Create an origin producer that can only publish this specific broadcast.
	let mut publisher = moq_lite::OriginProducer::new(broadcast.clone());

	// Establish the connection, not providing a subscriber.
	let session = moq_lite::Session::connect(session, publisher.consume_all(), None).await?;

	// Publish the broadcast using the origin producer directly.
	publisher.publish(broadcast, consumer.inner.clone());

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

async fn publish<T: AsyncRead + Unpin>(producer: BroadcastProducer, input: &mut T) -> anyhow::Result<()> {
	let mut import = Import::new(producer);

	import
		.init_from(input)
		.await
		.context("failed to initialize cmaf from input")?;

	tracing::info!("initialized");

	import.read_from(input).await?;

	Ok(())
}
