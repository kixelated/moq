use clap::Parser;
use serde::{Deserialize, Serialize};
use std::{net, path::PathBuf};

use crate::{AuthConfig, ClusterConfig};

#[derive(Parser, Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
	/// The QUIC/TLS configuration for the server.
	#[command(flatten)]
	pub server: moq_native::ServerConfig,

	/// The QUIC/TLS configuration for the client. (clustering only)
	#[command(flatten)]
	#[serde(default)]
	pub client: moq_native::ClientConfig,

	/// Log configuration.
	#[command(flatten)]
	#[serde(default)]
	pub log: moq_native::Log,

	/// Cluster configuration.
	#[command(flatten)]
	#[serde(default)]
	pub cluster: ClusterConfig,

	/// Authentication configuration.
	#[command(flatten)]
	#[serde(default)]
	pub auth: AuthConfig,

	/// HTTP server configuration.
	#[command(flatten)]
	#[serde(default)]
	pub http: HttpConfig,

	/// HTTPS server configuration.
	#[command(flatten)]
	#[serde(default)]
	pub https: HttpsConfig,

	/// If provided, load the configuration from this file.
	#[serde(default)]
	pub file: Option<String>,
}

impl Config {
	pub fn load() -> anyhow::Result<Self> {
		// Parse just the CLI arguments initially.
		let mut config = Config::parse();

		// If a file is provided, load it and merge the CLI arguments.
		if let Some(file) = config.file {
			config = toml::from_str(&std::fs::read_to_string(file)?)?;
			config.update_from(std::env::args());
		}

		config.log.init();
		tracing::trace!(?config, "final config");

		Ok(config)
	}
}

#[derive(Parser, Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields, default)]
pub struct HttpConfig {
	/// HTTP server bind address. If not provided, HTTP server is disabled.
	#[arg(long = "http-bind", env = "MOQ_HTTP_BIND")]
	pub bind: Option<net::SocketAddr>,
}

#[derive(Parser, Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields, default)]
pub struct HttpsConfig {
	/// HTTPS server bind address. If not provided, HTTPS server is disabled.
	#[arg(long = "https-bind", env = "MOQ_HTTPS_BIND")]
	pub bind: Option<net::SocketAddr>,

	/// Path to certificate chain file for HTTPS (PEM format)
	#[arg(long = "https-cert", env = "MOQ_HTTPS_CERT", requires = "bind")]
	pub cert: Option<PathBuf>,

	/// Path to private key file for HTTPS (PEM format)
	#[arg(long = "https-key", env = "MOQ_HTTPS_KEY", requires = "bind")]
	pub key: Option<PathBuf>,
}
