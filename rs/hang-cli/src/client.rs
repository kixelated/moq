use anyhow::Context;

use crate::import::{ImportManifest, ImportMedia};
use crate::ImportType;

use hang::moq_lite;
use tokio::io::AsyncRead;
use url::Url;

pub async fn client<T: AsyncRead + Unpin>(
	config: moq_native::ClientConfig,
	url: Url,
	name: String,
	format: ImportType,
	hls_url: Option<Url>,
	input: &mut T,
) -> anyhow::Result<()> {
	let broadcast = moq_lite::Broadcast::produce();
	let client = config.init()?;

	tracing::info!(%url, %name, "connecting");
	let session = client.connect(url).await?;

	let origin = moq_lite::Origin::produce();
	let session = moq_lite::Session::connect(session, origin.consumer, None).await?;
	origin.producer.publish_broadcast(&name, broadcast.consumer);

	let _ = sd_notify::notify(true, &[sd_notify::NotifyState::Ready]);

	if format == ImportType::Hls {
		let hls_url = hls_url.ok_or_else(|| anyhow::anyhow!("--hls-url is required when --format hls is specified"))?;

		let mut manifest = ImportManifest::new(broadcast.producer.into(), hls_url)?;
		manifest.init().await.context("failed to initialize manifest import")?;

		run_loop(manifest.service(), session).await
	} else {
		let mut media = ImportMedia::new(broadcast.producer.into(), format);
		media
			.init_from(input)
			.await
			.context("failed to initialize from media stream")?;

		run_loop(media.read_from(input), session).await
	}
}

async fn run_loop(
	task: impl std::future::Future<Output = anyhow::Result<()>>,
	session: moq_lite::Session<moq_native::web_transport_quinn::Session>,
) -> anyhow::Result<()> {
	tokio::select! {
		res = task => res,
		res = session.closed() => res.map_err(Into::into),
		_ = tokio::signal::ctrl_c() => {
			session.close(moq_lite::Error::Cancel);
			tokio::time::sleep(std::time::Duration::from_millis(100)).await;
			Ok(())
		},
	}
}
