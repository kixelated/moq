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
use writer::*;

/// A MoQ session, constructed with [Publisher] and [Subscriber] halves.
///
/// This simplifies the state machine and immediately rejects any subscriptions that don't match the origin prefix.
/// You probably want to use [Session] unless you're writing a relay.
#[derive(Clone)]
pub struct Session {
	pub webtransport: web_transport::Session,
}

impl Session {
	fn new(
		mut session: web_transport::Session,
		stream: Stream,
		// We will publish any local broadcasts from this origin.
		publish: Option<OriginConsumer>,
		// We will consume any remote broadcasts, inserting them into this origin.
		subscribe: Option<OriginProducer>,
	) -> Self {
		let publisher = SessionPublisher::new(session.clone(), publish);
		let subscriber = SessionSubscriber::new(session.clone());

		let this = Self {
			webtransport: session.clone(),
		};

		web_async::spawn(async move {
			let res = tokio::select! {
				res = Self::run_session(stream) => res,
				res = Self::run_bi(session.clone(), publisher.clone()) => res,
				res = Self::run_uni(session.clone(), subscriber.clone()) => res,
				//res = publisher.run() => res,
				// Ignore Ok (unused) or when subscribe is None.
				Some(Err(res)) = async move { Some(subscriber.run(subscribe?).await) } => Err(res),
			};

			match res {
				Err(Error::WebTransport(web_transport::Error::Session(_))) => {
					tracing::info!("session terminated");
					session.close(1, "");
				}
				Err(err) => {
					tracing::warn!(?err, "session error");
					session.close(err.to_code(), &err.to_string());
				}
				_ => {
					tracing::info!("session closed");
					session.close(0, "");
				}
			}
		});

		this
	}

	/// Perform the MoQ handshake as a client.
	pub async fn connect<
		T: Into<web_transport::Session>,
		P: Into<Option<OriginConsumer>>,
		C: Into<Option<OriginProducer>>,
	>(
		session: T,
		publish: P,
		subscribe: C,
	) -> Result<Self, Error> {
		let mut session = session.into();
		let mut stream = Stream::open(&mut session, message::ControlType::Session).await?;
		Self::connect_setup(&mut stream).await?;
		Ok(Self::new(session, stream, publish.into(), subscribe.into()))
	}

	async fn connect_setup(setup: &mut Stream) -> Result<(), Error> {
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
	pub async fn accept<
		T: Into<web_transport::Session>,
		P: Into<Option<OriginConsumer>>,
		C: Into<Option<OriginProducer>>,
	>(
		session: T,
		publish: P,
		subscribe: C,
	) -> Result<Self, Error> {
		let mut session = session.into();
		let mut stream = Stream::accept(&mut session).await?;
		let kind = stream.reader.decode().await?;

		if kind != message::ControlType::Session {
			return Err(Error::UnexpectedStream(kind));
		}

		Self::accept_setup(&mut stream).await?;
		Ok(Self::new(session, stream, publish.into(), subscribe.into()))
	}

	async fn accept_setup(control: &mut Stream) -> Result<(), Error> {
		let client: message::ClientSetup = control.reader.decode().await?;

		if !client.versions.contains(&message::Version::CURRENT) {
			return Err(Error::Version(client.versions, [message::Version::CURRENT].into()));
		}

		let server = message::ServerSetup {
			version: message::Version::CURRENT,
			extensions: Default::default(),
		};

		control.writer.encode(&server).await?;

		tracing::debug!(version = ?server.version, "connected");

		Ok(())
	}

	async fn run_session(mut stream: Stream) -> Result<(), Error> {
		while let Some(_info) = stream.reader.decode_maybe::<message::SubscribeOk>().await? {}
		Err(Error::Cancel)
	}

	async fn run_uni(mut session: web_transport::Session, subscriber: SessionSubscriber) -> Result<(), Error> {
		loop {
			let stream = Reader::accept(&mut session).await?;
			let subscriber = subscriber.clone();

			web_async::spawn(async move {
				Self::run_data(stream, subscriber).await.ok();
			});
		}
	}

	async fn run_data(mut stream: Reader, mut subscriber: SessionSubscriber) -> Result<(), Error> {
		let kind = stream.decode().await?;

		let res = match kind {
			message::DataType::Group => subscriber.recv_group(&mut stream).await,
		};

		if let Err(err) = res {
			stream.abort(&err);
		}

		Ok(())
	}

	async fn run_bi(mut session: web_transport::Session, publisher: SessionPublisher) -> Result<(), Error> {
		loop {
			let stream = Stream::accept(&mut session).await?;
			let publisher = publisher.clone();

			web_async::spawn(async move {
				Self::run_control(stream, publisher).await.ok();
			});
		}
	}

	async fn run_control(mut stream: Stream, mut publisher: SessionPublisher) -> Result<(), Error> {
		let kind = stream.reader.decode().await?;

		let res = match kind {
			message::ControlType::Session => Err(Error::UnexpectedStream(kind)),
			message::ControlType::Announce => publisher.recv_announce(&mut stream).await,
			message::ControlType::Subscribe => publisher.recv_subscribe(&mut stream).await,
		};

		if let Err(err) = &res {
			stream.writer.abort(err);
		}

		res
	}

	/// Close the underlying WebTransport session.
	pub fn close(mut self, err: Error) {
		self.webtransport.close(err.to_code(), &err.to_string());
	}

	/// Block until the WebTransport session is closed.
	pub async fn closed(&self) -> Error {
		self.webtransport.closed().await.into()
	}
}
