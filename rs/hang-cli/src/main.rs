mod client;
mod import;
mod server;

use std::path::PathBuf;

use client::*;
use import::*;
use server::*;

use clap::{Parser, Subcommand};
use url::Url;

#[derive(Parser, Clone)]
pub struct Cli {
	#[command(flatten)]
	log: moq_native::Log,

	#[command(subcommand)]
	command: Command,
}

#[derive(Subcommand, Clone)]
pub enum Command {
	Serve {
		#[command(flatten)]
		config: moq_native::ServerConfig,

		/// The name of the broadcast to serve.
		#[arg(long)]
		name: String,

		/// Optionally serve static files from the given directory.
		#[arg(long)]
		dir: Option<PathBuf>,

		/// The format of the input media.
		#[arg(long, value_enum, default_value_t = ImportType::Cmaf)]
		format: ImportType,
	},
	Publish {
		/// The MoQ client configuration.
		#[command(flatten)]
		config: moq_native::ClientConfig,

		/// The URL of the MoQ server.
		///
		/// The URL must start with `https://` or `http://`.
		/// - If `http` is used, a HTTP fetch to "/certificate.sha256" is first made to get the TLS certificiate fingerprint (insecure).
		/// - If `https` is used, then A WebTransport connection is made via QUIC to the provided host/port.
		///
		/// The `?jwt=` query parameter is used to provide a JWT token from moq-token-cli.
		/// Otherwise, the public path (if any) is used instead.
		///
		/// The path currently must be `/` or you'll get an error on connect.
		#[arg(long)]
		url: Url,

		/// The name of the broadcast to publish.
		#[arg(long)]
		name: String,

		/// The format of the input media.
		#[arg(long, value_enum, default_value_t = ImportType::Cmaf)]
		format: ImportType,
	},
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
	let cli = Cli::parse();
	cli.log.init();

	match cli.command {
		Command::Serve {
			config,
			dir,
			name,
			format,
		} => server(config, name, dir, format, &mut tokio::io::stdin()).await,
		Command::Publish {
			config,
			url,
			name,
			format,
		} => client(config, url, name, format, &mut tokio::io::stdin()).await,
	}
}
