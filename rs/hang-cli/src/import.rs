use anyhow::Context;
use clap::ValueEnum;
use hang::BroadcastProducer;
use tokio::io::AsyncRead;

#[derive(ValueEnum, Clone)]
pub enum ImportType {
	AnnexB,
	Cmaf,
}

impl ImportType {
	fn as_str(&self) -> &'static str {
		match self {
			ImportType::AnnexB => "annex-b",
			ImportType::Cmaf => "cmaf",
		}
	}
}

pub struct Import {
	inner: hang::import::Generic,
}

impl Import {
	pub fn new(broadcast: BroadcastProducer, format: ImportType) -> Self {
		let inner = hang::import::Generic::new(broadcast, format.as_str()).expect("supported format");
		Self { inner }
	}
}

impl Import {
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
