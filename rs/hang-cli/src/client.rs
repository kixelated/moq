use anyhow::Context;

use crate::import::{Manifest, Media};
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

		let mut manifest = Manifest::new(broadcast.producer.into(), &name, hls_url)?;
		manifest.init().await.context("failed to initialize manifest import")?;

		tokio::select! {
			res = manifest.service() => res,
			res = session.closed() => res.map_err(Into::into),
			_ = tokio::signal::ctrl_c() => {
				session.close(moq_lite::Error::Cancel);
				tokio::time::sleep(std::time::Duration::from_millis(100)).await;
				Ok(())
			},
		}
	} else {
		let mut media = Media::new(broadcast.producer.into(), format);
		media
			.init_from(input)
			.await
			.context("failed to initialize from media stream")?;

		tokio::select! {
			res = media.read_from(input) => res,
			res = session.closed() => res.map_err(Into::into),
			_ = tokio::signal::ctrl_c() => {
				session.close(moq_lite::Error::Cancel);
				tokio::time::sleep(std::time::Duration::from_millis(100)).await;
				Ok(())
			},
		}
	}
}
