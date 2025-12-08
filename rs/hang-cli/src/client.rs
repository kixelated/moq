

use anyhow::Context;

use hang::ingest::hls::{HlsConfig, Ingest};

use hang::moq_lite;
use reqwest::Client;
use tokio::io::AsyncRead;
use url::Url;


use crate::import::Import;
use crate::InputFormat;



pub async fn client<T: AsyncRead + Unpin>(
	config: moq_native::ClientConfig,
	url: Url,
	name: String,
	format: InputFormat,
	hls_url: Option<Url>,
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

	// Announce the broadcast as available once the catalog is ready.
	origin.producer.publish_broadcast(&name, broadcast.consumer);

	// Notify systemd that we're ready.
	let _ = sd_notify::notify(true, &[sd_notify::NotifyState::Ready]);

	// Branch based on whether we're doing HLS ingest or stdin-based import.
	if format == InputFormat::Hls {
		let hls_url = hls_url.ok_or_else(|| anyhow::anyhow!("--hls-url is required when --format hls is specified"))?;

		let http_client = Client::builder()
			.user_agent("hang-hls-ingest/0.1")
			.build()
			.context("failed to build HTTP client")?;

		let cfg = HlsConfig::new(hls_url);
		let mut ingest = Ingest::new(broadcast.producer.into(), cfg, http_client);

		ingest.prime().await.map_err(anyhow::Error::from)?;

		tokio::select! {
			res = ingest.run() => res.map_err(Into::into),

			res = session.closed() => res.map_err(Into::into),

			_ = tokio::signal::ctrl_c() => {
				session.close(moq_lite::Error::Cancel);
				tokio::time::sleep(std::time::Duration::from_millis(100)).await;
				Ok(())
			},
		}
	} else {
		let mut import = Import::new(broadcast.producer.into(), format);
		import
			.init_from(input)
			.await
			.context("failed to initialize from media stream")?;

		tokio::select! {
			res = import.read_from(input) => res,
			res = session.closed() => res.map_err(Into::into),

			_ = tokio::signal::ctrl_c() => {
				session.close(moq_lite::Error::Cancel);
				tokio::time::sleep(std::time::Duration::from_millis(100)).await;
				Ok(())
			},
		}
	}
}
