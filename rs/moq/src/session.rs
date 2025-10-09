use std::sync::Arc;

use crate::{
	coding::{self, Stream},
	ietf, lite, Error, OriginConsumer, OriginProducer,
};

pub struct Session<S: web_transport_trait::Session + Sync> {
	session: S,
}

impl<S: web_transport_trait::Session + Sync> Session<S> {
	fn new(session: S) -> Self {
		Self { session }
	}

	/// Perform the MoQ handshake as a client.
	///
	/// Publishing is performed with [OriginConsumer] and subscribing with [OriginProducer].
	/// The connection remains active until the session is closed.
	pub async fn connect(
		session: S,
		publish: impl Into<Option<OriginConsumer>>,
		subscribe: impl Into<Option<OriginProducer>>,
	) -> Result<Self, Error> {
		let mut stream = Stream::open(&session).await?;

		// Encode 0x40 on the wire so it's backwards compatible with moq-transport
		stream.writer.encode(&lite::ControlType::ClientCompat).await?;

		// moq-rs currently requires the ROLE extension to be set.
		let mut extensions = coding::Extensions::default();
		extensions.set(ietf::Role::Both);

		let client = lite::ClientSetup {
			versions: [coding::Version::LITE_LATEST, coding::Version::IETF_LATEST].into(),
			extensions: Default::default(),
		};

		stream.writer.encode(&client).await?;

		// We expect 0x41 as the response.
		let server_compat: lite::ControlType = stream.reader.decode().await?;
		if server_compat != lite::ControlType::ServerCompat {
			return Err(Error::UnexpectedStream);
		}

		let server: lite::ServerSetup = stream.reader.decode().await?;

		tracing::debug!(version = ?server.version, "connected");

		match server.version {
			coding::Version::LITE_LATEST => {
				lite::start(session.clone(), stream, publish.into(), subscribe.into()).await?
			}
			coding::Version::IETF_LATEST => {
				ietf::start(session.clone(), stream, publish.into(), subscribe.into()).await?
			}
			_ => return Err(Error::Version(client.versions, [coding::Version::LITE_LATEST].into())),
		};

		Ok(Self::new(session))
	}

	/// Perform the MoQ handshake as a client.
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

		if kind != lite::ControlType::Session && kind != lite::ControlType::ClientCompat {
			return Err(Error::UnexpectedStream);
		}

		let client: lite::ClientSetup = stream.reader.decode().await?;
		if !client.versions.contains(&coding::Version::LITE_LATEST) {
			return Err(Error::Version(client.versions, [coding::Version::LITE_LATEST].into()));
		}

		let server = lite::ServerSetup {
			version: coding::Version::LITE_LATEST,
			extensions: Default::default(),
		};

		// Backwards compatibility with moq-transport-07
		if kind == lite::ControlType::ClientCompat {
			// Write a 0x41 just to be backwards compatible.
			stream.writer.encode(&lite::ControlType::ServerCompat).await?;
		}

		stream.writer.encode(&server).await?;

		tracing::debug!(version = ?server.version, "connected");

		lite::start(session.clone(), stream, publish.into(), subscribe.into()).await?;

		Ok(Self::new(session))
	}

	/// Close the underlying transport session.
	pub fn close(self, err: Error) {
		self.session.close(err.to_code(), err.to_string().as_ref());
	}

	/// Block until the transport session is closed.
	pub async fn closed(&self) -> Error {
		Error::Transport(Arc::new(self.session.closed().await))
	}
}
