use std::sync::Arc;

use bytes::BytesMut;

use crate::{
	coding::{self, Encode, Stream},
	ietf::{self, Message},
	lite, Error, OriginConsumer, OriginProducer,
};

pub struct Session<S: web_transport_trait::Session> {
	session: S,
}

/// The versions of MoQ that are supported by this implementation.
///
/// Ordered by preference, with the client's preference taking priority.
const SUPPORTED: [coding::Version; 2] = [coding::Version::LITE_LATEST, coding::Version::IETF_LATEST];

impl<S: web_transport_trait::Session> Session<S> {
	fn new(session: S) -> Self {
		Self { session }
	}

	/// Perform the MoQ handshake as a client, negotiating the version.
	///
	/// Publishing is performed with [OriginConsumer] and subscribing with [OriginProducer].
	/// The connection remains active until the session is closed.
	pub async fn connect(
		session: S,
		publish: impl Into<Option<OriginConsumer>>,
		subscribe: impl Into<Option<OriginProducer>>,
	) -> Result<Self, Error> {
		let mut stream = Stream::open(&session).await?;

		let mut buf = BytesMut::new();

		// Encode 0x20 on the wire so it's backwards compatible with moq-transport draft 10+
		// Unfortunately, we have to choose one value blind as the client.
		lite::ControlType::ClientCompatV14.encode(&mut buf);

		let client = ietf::ClientSetup {
			versions: SUPPORTED.into(),
			extensions: Default::default(),
		};

		client.encode_size().encode(&mut buf);
		client.encode(&mut buf);
		stream.writer.write_all(&mut buf).await?;

		// We expect 0x21 as the response.
		let server_compat: lite::ControlType = stream.reader.decode().await?;

		if server_compat != lite::ControlType::ServerCompatV14 {
			return Err(Error::UnexpectedStream);
		}

		// This is a little manual, but whatever.
		let size: u16 = stream.reader.decode().await?;
		let mut buf = stream.reader.read_exact(size as usize).await?;

		let server = ietf::ServerSetup::decode(&mut buf)?;
		if !buf.is_empty() {
			return Err(Error::WrongSize);
		}

		match server.version {
			coding::Version::LITE_LATEST => {
				lite::start(session.clone(), stream, publish.into(), subscribe.into()).await?;
			}
			coding::Version::IETF_LATEST => {
				ietf::start(session.clone(), stream, true, publish.into(), subscribe.into()).await?;
			}
			_ => return Err(Error::Version(client.versions, [server.version].into())),
		}

		tracing::debug!(version = ?server.version, "connected");

		Ok(Self::new(session))
	}

	/// Perform the MoQ handshake as a server.
	///
	/// Publishing is performed with [OriginConsumer] and subscribing with [OriginProducer].
	/// The connection remains active until the session is closed.
	pub async fn accept(
		session: S,
		publish: impl Into<Option<OriginConsumer>>,
		subscribe: impl Into<Option<OriginProducer>>,
	) -> Result<Self, Error> {
		let mut stream = Stream::accept(&session).await?;
		let kind: lite::ControlType = stream.reader.decode().await?;

		let versions = match kind {
			lite::ControlType::Session | lite::ControlType::ClientCompatV7 => {
				let client: lite::ClientSetup = stream.reader.decode().await?;
				client.versions
			}
			// If it's draft-14 client, we need to write back a u16 for the size.
			lite::ControlType::ClientCompatV14 => {
				// TODO make this less manual
				let size: u16 = stream.reader.decode().await?;
				let mut buf = stream.reader.read_exact(size as usize).await?;
				let client: ietf::ClientSetup = ietf::ClientSetup::decode(&mut buf)?;
				if !buf.is_empty() {
					return Err(Error::WrongSize);
				}
				client.versions
			}
			_ => return Err(Error::UnexpectedStream),
		};

		let version = versions
			.iter()
			.find(|v| SUPPORTED.contains(v))
			.copied()
			.ok_or_else(|| Error::Version(versions, SUPPORTED.into()))?;

		// Backwards compatibility with moq-transport-07
		match kind {
			lite::ControlType::ClientCompatV14 => {
				stream.writer.encode(&lite::ControlType::ServerCompatV14).await?;

				// This type doesn't implement Encode (yet), so we have to do it manually.
				let setup = ietf::ServerSetup {
					version,
					extensions: Default::default(),
				};

				let mut buf = BytesMut::new();
				setup.encode_size().encode(&mut buf);
				setup.encode(&mut buf);
				stream.writer.write_all(&mut buf).await?;
			}
			lite::ControlType::ClientCompatV7 => {
				// Encode the ID so it's backwards compatibile.
				stream.writer.encode(&lite::ControlType::ServerCompatV7).await?;

				// NOTE: This is a lite message, but it's the same encoding as the IETF message.
				stream
					.writer
					.encode(&lite::ServerSetup {
						version,
						extensions: Default::default(),
					})
					.await?;
			}
			lite::ControlType::Session => {
				// No ID needed for moq-lite responses.
				stream
					.writer
					.encode(&lite::ServerSetup {
						version,
						extensions: Default::default(),
					})
					.await?;
			}
			_ => unreachable!(),
		}

		match version {
			coding::Version::LITE_LATEST => {
				lite::start(session.clone(), stream, publish.into(), subscribe.into()).await?;
			}
			coding::Version::IETF_LATEST => {
				ietf::start(session.clone(), stream, false, publish.into(), subscribe.into()).await?;
			}
			_ => unreachable!(),
		}

		tracing::debug!(?version, "connected");

		Ok(Self::new(session))
	}

	/// Close the underlying transport session.
	pub fn close(self, err: Error) {
		self.session.close(err.to_code(), err.to_string().as_ref());
	}

	/// Block until the transport session is closed.
	pub async fn closed(&self) -> Result<(), Error> {
		match self.session.closed().await {
			Ok(()) => Ok(()),
			Err(err) => Err(Error::Transport(Arc::new(err))),
		}
	}
}
