use std::sync::Arc;

use bytes::BytesMut;

use crate::{
	coding::{self, Encode, Stream},
	ietf::{self, Message, ParameterBytes, ParameterVarInt, RequestId},
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

		let mut parameters = ietf::Parameters::default();
		parameters.set_varint(ParameterVarInt::MaxRequestId, u32::MAX as u64);
		parameters.set_bytes(ParameterBytes::Implementation, b"moq-lite-rs".to_vec());

		let client = ietf::ClientSetup {
			versions: SUPPORTED.into(),
			parameters,
		};

		tracing::trace!(?client, "sending client setup");

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
		tracing::trace!(?server, "received server setup");

		if !buf.is_empty() {
			return Err(Error::WrongSize);
		}

		let request_id_max = RequestId(server.parameters.get_varint(ParameterVarInt::MaxRequestId).unwrap_or(0));

		match server.version {
			coding::Version::LITE_LATEST => {
				lite::start(session.clone(), stream, publish.into(), subscribe.into()).await?;
			}
			coding::Version::IETF_LATEST => {
				ietf::start(
					session.clone(),
					stream,
					request_id_max,
					true,
					publish.into(),
					subscribe.into(),
				)
				.await?;
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

		let (versions, request_id_max) = match kind {
			lite::ControlType::Session | lite::ControlType::ClientCompatV7 => {
				let client: lite::ClientSetup = stream.reader.decode().await?;
				(client.versions, None)
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
				let request_id_max = client.parameters.get_varint(ParameterVarInt::MaxRequestId).unwrap_or(0);
				(client.versions, Some(RequestId(request_id_max)))
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

				let mut parameters = ietf::Parameters::default();
				parameters.set_varint(ParameterVarInt::MaxRequestId, u32::MAX as u64);
				parameters.set_bytes(ParameterBytes::Implementation, b"moq-lite-rs".to_vec());

				// This type doesn't implement Encode (yet), so we have to do it manually.
				let setup = ietf::ServerSetup { version, parameters };

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
						parameters: Default::default(),
					})
					.await?;
			}
			lite::ControlType::Session => {
				// No ID needed for moq-lite responses.
				stream
					.writer
					.encode(&lite::ServerSetup {
						version,
						parameters: Default::default(),
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
				ietf::start(
					session.clone(),
					stream,
					request_id_max.unwrap_or(RequestId(0)),
					false,
					publish.into(),
					subscribe.into(),
				)
				.await?;
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
