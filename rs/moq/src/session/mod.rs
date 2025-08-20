use crate::{message, Error, OriginConsumer, OriginProducer};

mod publisher;
mod reader;
mod stream;
mod subscriber;
mod writer;

use publisher::*;
use reader::*;
use stream::*;
use subscriber::*;
use tokio::sync::oneshot;
use writer::*;

/// A MoQ session, constructed with [OriginProducer] and [OriginConsumer] halves.
///
/// This simplifies the state machine and immediately rejects any subscriptions that don't match the origin prefix.
/// You probably want to use [Session] unless you're writing a relay.
pub struct Session<S: web_transport_generic::Session> {
	pub transport: S,
}

impl<S: web_transport_generic::Session + Sync> Session<S> {
	async fn new(
		session: S,
		stream: Stream<S>,
		// We will publish any local broadcasts from this origin.
		publish: Option<OriginConsumer>,
		// We will consume any remote broadcasts, inserting them into this origin.
		subscribe: Option<OriginProducer>,
	) -> Result<Self, Error> {
		let publisher = Publisher::new(session.clone(), publish);
		let subscriber = Subscriber::new(session.clone(), subscribe);

		let this = Self {
			transport: session.clone(),
		};

		let init = oneshot::channel();

		web_async::spawn(async move {
			let res = tokio::select! {
				res = Self::run_session(stream) => res,
				res = publisher.run() => res,
				res = subscriber.run(init.0) => res,
			};

			match res {
				Err(Error::Transport(_)) => {
					tracing::info!("session terminated");
					session.close(1, "");
				}
				Err(err) => {
					tracing::warn!(%err, "session error");
					session.close(err.to_code(), err.to_string().as_ref());
				}
				_ => {
					tracing::info!("session closed");
					session.close(0, "");
				}
			}
		});

		// Wait until receiving the initial announcements to prevent some race conditions.
		// Otherwise, `consume()` might return not found if we don't wait long enough, so just wait.
		// If the announce stream fails or is closed, this will return an error instead of hanging.
		// TODO return a better error
		init.1.await.map_err(|_| Error::Cancel)?;

		Ok(this)
	}

	/// Perform the MoQ handshake as a client.
	pub async fn connect(
		session: S,
		publish: impl Into<Option<OriginConsumer>>,
		subscribe: impl Into<Option<OriginProducer>>,
	) -> Result<Self, Error> {
		let mut stream = Stream::open(&session, message::ControlType::Session).await?;
		Self::connect_setup(&mut stream).await?;
		let session = Self::new(session, stream, publish.into(), subscribe.into()).await?;
		Ok(session)
	}

	async fn connect_setup(setup: &mut Stream<S>) -> Result<(), Error> {
		let client = message::ClientSetup {
			versions: [message::Version::CURRENT].into(),
			extensions: Default::default(),
		};

		setup.writer.encode(&client).await?;
		let server: message::ServerSetup = setup.reader.decode().await?;

		tracing::debug!(version = ?server.version, "connected");

		Ok(())
	}

	/// Perform the MoQ handshake as a server
	pub async fn accept<P: Into<Option<OriginConsumer>>, C: Into<Option<OriginProducer>>>(
		session: S,
		publish: P,
		subscribe: C,
	) -> Result<Self, Error> {
		tracing::info!("accepting session");
		let mut stream = Stream::accept(&session).await?;
		tracing::info!("got stream");
		let kind = stream.reader.decode().await?;
		tracing::info!(?kind, "got kind");

		Self::accept_setup(kind, &mut stream).await?;
		let session = Self::new(session, stream, publish.into(), subscribe.into()).await?;
		Ok(session)
	}

	async fn accept_setup(kind: message::ControlType, control: &mut Stream<S>) -> Result<(), Error> {
		if kind != message::ControlType::Session && kind != message::ControlType::ClientCompat {
			return Err(Error::UnexpectedStream(kind));
		}

		tracing::info!("decoding client setup");
		let client: message::ClientSetup = control.reader.decode().await?;
		tracing::info!(?client, "got client setup");

		if !client.versions.contains(&message::Version::CURRENT) {
			return Err(Error::Version(client.versions, [message::Version::CURRENT].into()));
		}

		let server = message::ServerSetup {
			version: message::Version::CURRENT,
			extensions: Default::default(),
		};

		// Backwards compatibility with moq-transport-10
		if kind == message::ControlType::ClientCompat {
			// Write a 0x41 just to be backwards compatible.
			control.writer.encode(&message::ControlType::ServerCompat).await?;
		}

		tracing::info!("sending server setup");
		control.writer.encode(&server).await?;
		tracing::info!("sent server setup");

		tracing::debug!(version = ?server.version, "connected");

		Ok(())
	}

	// TODO do something useful with this
	async fn run_session(mut stream: Stream<S>) -> Result<(), Error> {
		while let Some(_info) = stream.reader.decode_maybe::<message::SessionInfo>().await? {}
		Err(Error::Cancel)
	}

	/// Close the underlying transport session.
	pub fn close(self, err: Error) {
		self.transport.close(err.to_code(), err.to_string().as_ref());
	}

	/// Block until the transport session is closed.
	pub async fn closed(&self) -> Error {
		Error::Transport(self.transport.closed().await.into())
	}
}
