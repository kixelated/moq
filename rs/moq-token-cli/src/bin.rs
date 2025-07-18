use anyhow::Context;
use clap::{Parser, Subcommand};
use std::{io, path::PathBuf};

#[derive(Debug, Parser)]
#[command(name = "moq-token")]
#[command(about = "Generate, sign, and verify tokens for moq-relay", long_about = None)]
struct Cli {
	/// The path for the key.
	#[arg(long)]
	key: PathBuf,

	/// The command to execute.
	#[command(subcommand)]
	command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
	/// Generate a key (pair) for the given algorithm.
	///
	/// The key is output to the provided -key path.
	Generate {
		/// The algorithm to use.
		#[arg(long, default_value = "HS256")]
		algorithm: moq_token::Algorithm,

		/// An optional key ID, useful for rotating keys.
		#[arg(long)]
		id: Option<String>,
	},

	/// Sign a token to stdout, reading the key from stdin.
	Sign {
		/// Appended to the publish/subscribe options to form the full name.
		/// It's mostly for compression and is optional, defaulting to the empty string.
		#[arg(long, default_value = "")]
		path: String,

		/// If specified, the user can publish any matching broadcasts.
		/// If not specified, the user will not publish any broadcasts.
		#[arg(long)]
		publish: Option<String>,

		/// If true, then this client is considered a cluster node.
		/// Both the client and server will only announce broadcasts from non-cluster clients.
		/// This avoids convoluted routing, as only the primary origin will announce.
		#[arg(long)]
		cluster: bool,

		/// If specified, the user can subscribe to any matching broadcasts.
		/// If not specified, the user will not receive announcements and cannot subscribe to any broadcasts.
		#[arg(long)]
		subscribe: Option<String>,

		/// The expiration time of the token as a unix timestamp.
		#[arg(long, value_parser = parse_unix_timestamp)]
		expires: Option<std::time::SystemTime>,

		/// The issued time of the token as a unix timestamp.
		#[arg(long, value_parser = parse_unix_timestamp)]
		issued: Option<std::time::SystemTime>,
	},

	/// Verify a token from stdin, writing the payload to stdout.
	/// NOTE: You still need to verify that the path is valid for the token.
	/// This just verifies the signature.
	Verify,
}

fn main() -> anyhow::Result<()> {
	let cli = Cli::parse();

	match cli.command {
		Commands::Generate { algorithm, id } => {
			let key = moq_token::Key::generate(algorithm, id);
			key.to_file(cli.key)?;
		}

		Commands::Sign {
			path,
			publish,
			cluster,
			subscribe,
			expires,
			issued,
		} => {
			let key = moq_token::Key::from_file(cli.key)?;

			let payload = moq_token::Claims {
				path,
				publish,
				cluster,
				subscribe,
				expires,
				issued,
			};

			let token = key.encode(&payload)?;
			println!("{token}");
		}

		Commands::Verify => {
			let key = moq_token::Key::from_file(cli.key)?;
			let token = io::read_to_string(io::stdin())?.trim().to_string();
			let payload = key.decode(&token)?;

			println!("{payload:#?}");
		}
	}

	Ok(())
}

// A simpler parser for clap
fn parse_unix_timestamp(s: &str) -> anyhow::Result<std::time::SystemTime> {
	let timestamp = s.parse::<i64>().context("expected unix timestamp")?;
	let timestamp = timestamp.try_into().context("timestamp out of range")?;
	Ok(std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(timestamp))
}
