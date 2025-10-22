use crate::{
	coding::{Reader, Stream, Writer},
	ietf::{self, Control, MessageId},
	Error, OriginConsumer, OriginProducer,
};

use super::{Publisher, Subscriber};

pub(crate) async fn start<S: web_transport_trait::Session>(
	session: S,
	setup: Stream<S>,
	publish: Option<OriginConsumer>,
	subscribe: Option<OriginProducer>,
) -> Result<(), Error> {
	web_async::spawn(async move {
		match run(session.clone(), setup, publish, subscribe).await {
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

	Ok(())
}

async fn run<S: web_transport_trait::Session>(
	session: S,
	setup: Stream<S>,
	publish: Option<OriginConsumer>,
	subscribe: Option<OriginProducer>,
) -> Result<(), Error> {
	let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
	let control = Control::new(tx);
	let publisher = Publisher::new(session.clone(), publish, control.clone());
	let subscriber = Subscriber::new(session.clone(), subscribe, control);

	tokio::select! {
		res = subscriber.clone().run() => res,
		res = publisher.clone().run() => res,
		res = run_control_read(setup.reader, publisher, subscriber) => res,
		res = run_control_write::<S>(setup.writer, rx) => res,
	}
}

async fn run_control_read<S: web_transport_trait::Session>(
	mut control: Reader<S::RecvStream>,
	mut publisher: Publisher<S>,
	mut subscriber: Subscriber<S>,
) -> Result<(), Error> {
	loop {
		let id: MessageId = control.decode().await?;
		match id {
			MessageId::Subscribe => {
				let msg: ietf::Subscribe = control.decode().await?;
				publisher.recv_subscribe(msg)?;
			}
			MessageId::SubscribeUpdate => return Err(Error::Unsupported),
			MessageId::SubscribeOk => {
				let msg: ietf::SubscribeOk = control.decode().await?;
				subscriber.recv_subscribe_ok(msg)?;
			}
			MessageId::SubscribeError => {
				let msg: ietf::SubscribeError = control.decode().await?;
				subscriber.recv_subscribe_error(msg)?;
			}
			MessageId::Announce => {
				let msg: ietf::Announce = control.decode().await?;
				subscriber.recv_announce(msg)?;
			}
			MessageId::AnnounceOk => {
				let msg: ietf::AnnounceOk = control.decode().await?;
				publisher.recv_announce_ok(msg)?;
			}
			MessageId::AnnounceError => return Err(Error::Unsupported),
			MessageId::Unannounce => {
				let msg: ietf::Unannounce = control.decode().await?;
				subscriber.recv_unannounce(msg)?;
			}
			MessageId::Unsubscribe => {
				let msg: ietf::Unsubscribe = control.decode().await?;
				publisher.recv_unsubscribe(msg)?;
			}
			MessageId::SubscribeDone => {
				let msg: ietf::SubscribeDone = control.decode().await?;
				subscriber.recv_subscribe_done(msg)?;
			}
			MessageId::AnnounceCancel => return Err(Error::Unsupported),
			MessageId::TrackStatusRequest => return Err(Error::Unsupported),
			MessageId::TrackStatus => return Err(Error::Unsupported),
			MessageId::GoAway => return Err(Error::Unsupported),
			MessageId::SubscribeAnnounces => {
				let msg: ietf::SubscribeAnnounces = control.decode().await?;
				publisher.recv_subscribe_announces(msg)?;
			}
			MessageId::SubscribeAnnouncesOk => return Err(Error::Unsupported),
			MessageId::SubscribeAnnouncesError => return Err(Error::Unsupported),
			MessageId::UnsubscribeAnnounces => {
				let msg: ietf::UnsubscribeAnnounces = control.decode().await?;
				publisher.recv_unsubscribe_announces(msg)?;
			}
			MessageId::MaxSubscribeId => return Err(Error::Unsupported),
			MessageId::Fetch => return Err(Error::Unsupported),
			MessageId::FetchCancel => return Err(Error::Unsupported),
			MessageId::FetchOk => return Err(Error::Unsupported),
			MessageId::FetchError => return Err(Error::Unsupported),
			MessageId::ClientSetup | MessageId::ServerSetup => return Err(Error::UnexpectedMessage),
		}
	}
}

async fn run_control_write<S: web_transport_trait::Session>(
	mut control: Writer<S::SendStream>,
	mut rx: tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>,
) -> Result<(), Error> {
	while let Some(msg) = rx.recv().await {
		let mut buf = std::io::Cursor::new(msg);
		control.write_all(&mut buf).await?;
	}

	Ok(())
}
