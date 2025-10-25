use clap::ValueEnum;
use hang::moq_lite::BroadcastProducer;
use tokio::io::AsyncRead;

#[derive(ValueEnum, Clone)]
pub enum ImportType {
	AnnexB,
	Cmaf,
}

pub enum Import {
	AnnexB(hang::annexb::Import),
	Cmaf(Box<hang::cmaf::Import>),
}

impl Import {
	pub fn new(broadcast: BroadcastProducer, format: ImportType) -> Self {
		match format {
			ImportType::AnnexB => Self::AnnexB(hang::annexb::Import::new(broadcast)),
			ImportType::Cmaf => Self::Cmaf(Box::new(hang::cmaf::Import::new(broadcast))),
		}
	}
}

impl Import {
	pub async fn init_from<T: AsyncRead + Unpin>(&mut self, input: &mut T) -> anyhow::Result<()> {
		match self {
			Self::AnnexB(_import) => Ok(()), // TODO: Implement
			Self::Cmaf(import) => import.init_from(input).await.map_err(Into::into),
		}
	}

	pub async fn read_from<T: AsyncRead + Unpin>(&mut self, input: &mut T) -> anyhow::Result<()> {
		match self {
			Self::AnnexB(import) => import.read_from(input).await.map_err(Into::into),
			Self::Cmaf(import) => import.read_from(input).await.map_err(Into::into),
		}
	}
}
