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
		/// The URL path that this token is valid for, minus the starting `/`.
		///
		/// This path is the root for all other publish/subscribe paths below.
		/// If the combined path ends with a `/`, then it's treated as a prefix.
		/// If the combined path does not end with a `/`, then it's treated as a specific broadcast.
		#[arg(long)]
		path: String,

		/// If specified, the user can publish any matching broadcasts.
		/// If not specified, the user will not publish any broadcasts.
		#[arg(long)]
		publish: Option<String>,

		/// If true, then any broadcasts published by this user should be considered secondary.
		/// This is primarily used for gossiping broadcasts between cluster nodes.
		/// They will only gossip primary broadcasts, and use each other as secondaries.
		#[arg(long)]
		publish_secondary: bool,

		/// If specified, the user can subscribe to any matching broadcasts.
		/// If not specified, the user will not receive announcements and cannot subscribe to any broadcasts.
		#[arg(long)]
		subscribe: Option<String>,

		/// If true, then this session will only receive primary broadcasts.
		/// This is primarily used for gossiping broadcasts between cluster nodes.
		/// We don't want nodes gossiping themselves as origins if they're just a middle node.
		#[arg(long)]
		subscribe_primary: bool,

		/// The expiration time of the token as a unix timestamp.
		#[arg(long, value_parser = parse_unix_timestamp)]
		expires: Option<std::time::SystemTime>,

		/// The issued time of the token as a unix timestamp.
		#[arg(long, value_parser = parse_unix_timestamp)]
		issued: Option<std::time::SystemTime>,
	},

	/// Verify a token from stdin, writing the payload to stdout.
	Verify {
		/// The expected path of the token.
		#[arg(long)]
		path: String,
	},
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
			publish_secondary,
			subscribe,
			subscribe_primary,
			expires,
			issued,
		} => {
			let key = moq_token::Key::from_file(cli.key)?;

			let payload = moq_token::Payload {
				path,
				publish,
				publish_secondary,
				subscribe,
				subscribe_primary,
				expires,
				issued,
			};

			let token = key.sign(&payload)?;
			println!("{}", token);
		}

		Commands::Verify { path } => {
			let key = moq_token::Key::from_file(cli.key)?;
			let token = io::read_to_string(io::stdin())?;
			let payload = key.verify(&token, &path)?;

			println!("{:#?}", payload);
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
