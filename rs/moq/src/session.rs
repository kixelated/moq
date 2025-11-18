use std::sync::Arc;

use crate::{
	coding::{self, Stream},
	ietf::{self, Message, ParameterBytes, ParameterVarInt, RequestId},
	lite, Error, OriginConsumer, OriginProducer,
};

pub struct Session<S: web_transport_trait::Session> {
	session: S,
}

/// The versions of MoQ that are supported by this implementation.
///
/// Ordered by preference, with the client's preference taking priority.
pub const VERSIONS: [coding::Version; 3] = [
	lite::Version::Draft02.coding(),
	lite::Version::Draft01.coding(),
	ietf::Version::Draft14.coding(),
];

/// The ALPN strings for supported versions.
pub const ALPNS: [&str; 2] = [lite::ALPN, ietf::ALPN];

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
		let mut stream = Stream::open(&session, ietf::Version::Draft14).await?;

		// Encode 0x20 on the wire so it's backwards compatible with moq-transport draft 10+
		// Unfortunately, we have to choose one value blind as the client.
		stream.writer.encode(&lite::ControlType::ClientCompatV14).await?;

		let mut parameters = ietf::Parameters::default();
		parameters.set_varint(ParameterVarInt::MaxRequestId, u32::MAX as u64);
		parameters.set_bytes(ParameterBytes::Implementation, b"moq-lite-rs".to_vec());

		let client = ietf::ClientSetup {
			versions: VERSIONS.into(),
			parameters,
		};

		tracing::trace!(?client, "sending client setup");
		stream.writer.encode(&client).await?;

		// We expect 0x21 as the response.
		let server_compat: lite::ControlType = stream.reader.decode().await?;

		if server_compat != lite::ControlType::ServerCompatV14 {
			return Err(Error::UnexpectedStream);
		}

		// Decode server setup manually
		let size: u16 = stream.reader.decode().await?;
		let mut buf = stream.reader.read_exact(size as usize).await?;
		let server = ietf::ServerSetup::decode(&mut buf, ietf::Version::Draft14)?;
		if !buf.is_empty() {
			return Err(Error::WrongSize);
		}
		tracing::trace!(?server, "received server setup");

		let request_id_max = RequestId(server.parameters.get_varint(ParameterVarInt::MaxRequestId).unwrap_or(0));

		if let Ok(version) = lite::Version::try_from(server.version) {
			let stream = stream.with_version(version);
			lite::start(session.clone(), stream, publish.into(), subscribe.into(), version).await?;
		} else if let Ok(version) = ietf::Version::try_from(server.version) {
			ietf::start(
				session.clone(),
				stream,
				request_id_max,
				true,
				publish.into(),
				subscribe.into(),
				version,
			)
			.await?;
		} else {
			return Err(Error::Version(client.versions, [server.version].into()));
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
		// Accept with an initial version; we'll switch to the negotiated version later
		let mut stream = Stream::accept(&session, ietf::Version::Draft14).await?;
		let kind: lite::ControlType = stream.reader.decode().await?;

		match kind {
			lite::ControlType::ClientCompatV14 => {
				Self::accept_ietf(session, stream.with_version(ietf::Version::Draft14), publish, subscribe).await
			}
			lite::ControlType::Session | lite::ControlType::ClientCompatV7 => {
				Self::accept_lite(
					session,
					kind,
					stream.with_version(lite::Version::Draft02),
					publish,
					subscribe,
				)
				.await
			}
			_ => Err(Error::UnexpectedStream),
		}
	}

	// When the first byte is a ClientCompatV7 or Session
	// NOTE: The negotiated version could still be IETF, but unlikely.
	async fn accept_lite(
		session: S,
		kind: lite::ControlType,
		mut stream: Stream<S, lite::Version>,
		publish: impl Into<Option<OriginConsumer>>,
		subscribe: impl Into<Option<OriginProducer>>,
	) -> Result<Self, Error> {
		let client: lite::ClientSetup = stream.reader.decode().await?;

		let version = client
			.versions
			.iter()
			.find(|v| VERSIONS.contains(v))
			.copied()
			.ok_or_else(|| Error::Version(client.versions.clone(), VERSIONS.into()))?;

		if kind == lite::ControlType::ClientCompatV7 {
			// Encode the ID so it's backwards compatibile.
			stream.writer.encode(&lite::ControlType::ServerCompatV7).await?;
		}

		let server = lite::ServerSetup {
			version,
			parameters: Default::default(),
		};

		stream.writer.encode(&server).await?;

		if let Ok(version) = lite::Version::try_from(version) {
			let stream = stream.with_version(version);
			lite::start(session.clone(), stream, publish.into(), subscribe.into(), version).await?;
		} else if let Ok(version) = ietf::Version::try_from(version) {
			let stream = stream.with_version(version);
			ietf::start(
				session.clone(),
				stream,
				RequestId(0),
				false,
				publish.into(),
				subscribe.into(),
				version,
			)
			.await?;
		} else {
			return Err(Error::Version(client.versions, VERSIONS.into()));
		}

		tracing::debug!(?version, "connected");

		Ok(Self::new(session))
	}

	// When the first byte is a ClientCompatV14
	// NOTE: The negotiated version could still be LITE.
	async fn accept_ietf(
		session: S,
		mut stream: Stream<S, ietf::Version>,
		publish: impl Into<Option<OriginConsumer>>,
		subscribe: impl Into<Option<OriginProducer>>,
	) -> Result<Self, Error> {
		let client: ietf::ClientSetup = stream.reader.decode().await?;
		let version = client
			.versions
			.iter()
			.find(|v| VERSIONS.contains(v))
			.copied()
			.ok_or_else(|| Error::Version(client.versions.clone(), VERSIONS.into()))?;
		let request_id_max = RequestId(client.parameters.get_varint(ParameterVarInt::MaxRequestId).unwrap_or(0));

		stream.writer.encode(&lite::ControlType::ServerCompatV14).await?;

		let mut parameters = ietf::Parameters::default();
		parameters.set_varint(ParameterVarInt::MaxRequestId, u32::MAX as u64);
		parameters.set_bytes(ParameterBytes::Implementation, b"moq-lite-rs".to_vec());

		let server = ietf::ServerSetup { version, parameters };
		stream.writer.encode(&server).await?;

		if let Ok(version) = lite::Version::try_from(version) {
			let stream = stream.with_version(version);
			lite::start(session.clone(), stream, publish.into(), subscribe.into(), version).await?;
		} else if let Ok(version) = ietf::Version::try_from(version) {
			let stream = stream.with_version(version);
			ietf::start(
				session.clone(),
				stream,
				request_id_max,
				false,
				publish.into(),
				subscribe.into(),
				version,
			)
			.await?;
		} else {
			return Err(Error::Version(client.versions, VERSIONS.into()));
		}

		tracing::debug!(?version, "connected");

		Ok(Self::new(session))
	}

	/// Close the underlying transport session.
	pub fn close(self, err: Error) {
		self.session.close(err.to_code(), err.to_string().as_ref());
	}

	/// Block until the transport session is closed.
	// TODO Remove the Result the next time we make a breaking change.
	pub async fn closed(&self) -> Result<(), Error> {
		Err(Error::Transport(Arc::new(self.session.closed().await)))
	}
}
