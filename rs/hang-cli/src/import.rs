use anyhow::Context;
use clap::ValueEnum;
use hang::BroadcastProducer;
use reqwest::Client;
use tokio::io::AsyncRead;
use url::Url;

#[derive(ValueEnum, Clone, PartialEq)]
pub enum ImportType {
	AnnexB,
	Cmaf,
	Hls,
}

impl ImportType {
	fn as_str(&self) -> &'static str {
		match self {
			ImportType::AnnexB => "annex-b",
			ImportType::Cmaf => "cmaf",
			ImportType::Hls => "hls",
		}
	}
}

pub struct ImportMedia {
	inner: hang::import::media::ImportMedia,
}

impl ImportMedia {
	pub fn new(broadcast: BroadcastProducer, format: ImportType) -> Self {
		let inner = hang::import::media::ImportMedia::new(broadcast, format.as_str()).expect("supported format");
		Self { inner }
	}
}

impl ImportMedia {
	pub async fn init_from<T: AsyncRead + Unpin>(&mut self, input: &mut T) -> anyhow::Result<()> {
		self.inner
			.initialize_from(input)
			.await
			.context("failed to parse media headers")
	}

	pub async fn read_from<T: AsyncRead + Unpin>(&mut self, input: &mut T) -> anyhow::Result<()> {
		self.inner.decode_from(input).await
	}
}

pub struct ImportManifest {
	inner: hang::import::manifest::ImportManifest,
}

impl ImportManifest {
	pub fn new(broadcast: BroadcastProducer, url: Url) -> anyhow::Result<Self> {
		let http_client = Client::builder()
			.user_agent(concat!(env!("CARGO_PKG_NAME"), "/", env!("CARGO_PKG_VERSION")))
			.build()
			.context("failed to build HTTP client")?;

		let inner = hang::import::manifest::ImportManifest::new(broadcast, "hls", url, http_client)
			.ok_or_else(|| anyhow::anyhow!("failed to create manifest importer"))?;

		Ok(Self { inner })
	}

	pub async fn init(&mut self) -> anyhow::Result<()> {
		self.inner.init().await.map_err(Into::into)
	}

	pub async fn service(&mut self) -> anyhow::Result<()> {
		self.inner.service().await.map_err(Into::into)
	}
}
