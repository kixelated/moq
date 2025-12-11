use clap::ValueEnum;
use hang::{moq_lite::coding::BytesMut, BroadcastProducer};
use tokio::io::{AsyncRead, AsyncReadExt};

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
	decoder: hang::import::DecoderStream,
	buffer: BytesMut,
}

impl Import {
	pub fn new(broadcast: BroadcastProducer, format: ImportType) -> Self {
		let decoder = hang::import::DecoderStream::new(broadcast, format.as_str()).expect("supported format");
		Self {
			decoder,
			buffer: BytesMut::new(),
		}
	}
}

impl Import {
	pub async fn init_from<T: AsyncRead + Unpin>(&mut self, input: &mut T) -> anyhow::Result<()> {
		while !self.decoder.is_initialized() && input.read_buf(&mut self.buffer).await? > 0 {
			self.decoder.decode(&mut self.buffer, None)?;
		}

		Ok(())
	}

	pub async fn read_from<T: AsyncRead + Unpin>(&mut self, input: &mut T) -> anyhow::Result<()> {
		while input.read_buf(&mut self.buffer).await? > 0 {
			self.decoder.decode(&mut self.buffer, None)?;
		}

		Ok(())
	}
}
