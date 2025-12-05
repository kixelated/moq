use crate::import::Import;
use crate::ImportType;
use anyhow::Context;
use hang::moq_lite;
use tokio::io::AsyncRead;
use url::Url;

pub async fn client<T: AsyncRead + Unpin>(
	config: moq_native::ClientConfig,
	url: Url,
	name: String,
	format: ImportType,
	input: &mut T,
) -> anyhow::Result<()> {
	let broadcast = moq_lite::Broadcast::produce();
	let client = config.init()?;

	tracing::info!(%url, %name, "connecting");
	let session = client.connect(url).await?;

	// Create an origin producer to publish to the broadcast.
	let origin = moq_lite::Origin::produce();

	// Establish the connection, not providing a subscriber.
	let session = moq_lite::Session::connect(session, origin.consumer, None).await?;

	let mut import = Import::new(broadcast.producer.into(), format);
	import
		.init_from(input)
		.await
		.context("failed to initialize from media stream")?;

	// Announce the broadcast as available once the catalog is ready.
	origin.producer.publish_broadcast(&name, broadcast.consumer);

	// Notify systemd that we're ready.
	let _ = sd_notify::notify(true, &[sd_notify::NotifyState::Ready]);

	tokio::select! {
		res = import.read_from(input) => res,
		res = session.closed() => res.map_err(Into::into),

		_ = tokio::signal::ctrl_c() => {
			session.close(moq_lite::Error::Cancel);

			// Give it a chance to close.
			tokio::time::sleep(std::time::Duration::from_millis(100)).await;
			Ok(())
		},
	}
}
