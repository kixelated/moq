use reqwest::Client;
use url::Url;

use crate::{BroadcastProducer, Result};

pub mod hls;

pub enum Protocol {
	Hls(hls::Hls),
}

/// A generic interface for importing a manifest (playlist) into a hang broadcast.
pub struct Manifest {
	protocol: Protocol,
}

impl Manifest {
	pub fn new(broadcast: BroadcastProducer, format: &str, url: Url, client: Client) -> Option<Self> {
		let protocol = match format {
			"hls" => {
				let config = hls::HlsConfig::new(url);
				Protocol::Hls(hls::Hls::new(broadcast, config, client))
			}
			_ => return None,
		};

		Some(Self { protocol })
	}

	pub async fn init(&mut self) -> Result<()> {
		match &mut self.protocol {
			Protocol::Hls(hls) => hls.init().await,
		}
	}

	pub async fn service(&mut self) -> Result<()> {
		match &mut self.protocol {
			Protocol::Hls(hls) => hls.service().await,
		}
	}
}
