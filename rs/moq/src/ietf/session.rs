use crate::{
	coding::{Reader, Stream, Writer},
	ietf::{self, Control, Message},
	Error, OriginConsumer, OriginProducer,
};

use super::{Publisher, Subscriber};

pub(crate) async fn start<S: web_transport_trait::Session + Sync>(
	session: S,
	setup: Stream<S>,
	client: bool,
	publish: Option<OriginConsumer>,
	subscribe: Option<OriginProducer>,
) -> Result<(), Error> {
	web_async::spawn(async move {
		match run(session.clone(), setup, client, publish, subscribe).await {
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

async fn run<S: web_transport_trait::Session + Sync>(
	session: S,
	setup: Stream<S>,
	client: bool,
	publish: Option<OriginConsumer>,
	subscribe: Option<OriginProducer>,
) -> Result<(), Error> {
	let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
	let control = Control::new(tx, client);
	let publisher = Publisher::new(session.clone(), publish, control.clone());
	let subscriber = Subscriber::new(session.clone(), subscribe, control);

	tokio::select! {
		res = subscriber.clone().run() => res,
		res = publisher.clone().run() => res,
		res = run_control_read(setup.reader, publisher, subscriber) => res,
		res = run_control_write::<S>(setup.writer, rx) => res,
	}
}

async fn run_control_read<S: web_transport_trait::Session + Sync>(
	mut control: Reader<S::RecvStream>,
	mut publisher: Publisher<S>,
	mut subscriber: Subscriber<S>,
) -> Result<(), Error> {
	loop {
		let id: u64 = control.decode().await?;
		let size: u16 = control.decode::<u16>().await?;
		let mut data = control.read_exact(size as usize).await?;

		match id {
			ietf::Subscribe::ID => {
				let msg = ietf::Subscribe::decode(&mut data)?;
				publisher.recv_subscribe(msg)?;
			}
			ietf::SubscribeUpdate::ID => return Err(Error::Unsupported),
			ietf::SubscribeOk::ID => {
				let msg = ietf::SubscribeOk::decode(&mut data)?;
				subscriber.recv_subscribe_ok(msg)?;
			}
			ietf::SubscribeError::ID => {
				let msg = ietf::SubscribeError::decode(&mut data)?;
				subscriber.recv_subscribe_error(msg)?;
			}
			ietf::PublishNamespace::ID => {
				let msg = ietf::PublishNamespace::decode(&mut data)?;
				subscriber.recv_publish_namespace(msg)?;
			}
			ietf::PublishNamespaceOk::ID => {
				let msg = ietf::PublishNamespaceOk::decode(&mut data)?;
				publisher.recv_publish_namespace_ok(msg)?;
			}
			ietf::PublishNamespaceError::ID => {
				let msg = ietf::PublishNamespaceError::decode(&mut data)?;
				publisher.recv_publish_namespace_error(msg)?;
			}
			ietf::PublishNamespaceDone::ID => {
				let msg = ietf::PublishNamespaceDone::decode(&mut data)?;
				subscriber.recv_publish_namespace_done(msg)?;
			}
			ietf::Unsubscribe::ID => {
				let msg = ietf::Unsubscribe::decode(&mut data)?;
				publisher.recv_unsubscribe(msg)?;
			}
			ietf::PublishDone::ID => {
				let msg = ietf::PublishDone::decode(&mut data)?;
				subscriber.recv_publish_done(msg)?;
			}
			ietf::PublishNamespaceCancel::ID => {
				let msg = ietf::PublishNamespaceCancel::decode(&mut data)?;
				publisher.recv_publish_namespace_cancel(msg)?;
			}
			ietf::TrackStatusRequest::ID => {
				let msg = ietf::TrackStatusRequest::decode(&mut data)?;
				publisher.recv_track_status_request(msg)?;
			}
			ietf::TrackStatus::ID => {
				let msg = ietf::TrackStatus::decode(&mut data)?;
				subscriber.recv_track_status(msg)?;
			}
			ietf::GoAway::ID => return Err(Error::Unsupported),
			ietf::SubscribeNamespace::ID => {
				let msg = ietf::SubscribeNamespace::decode(&mut data)?;
				publisher.recv_subscribe_namespace(msg)?;
			}
			ietf::SubscribeNamespaceOk::ID => {
				let msg = ietf::SubscribeNamespaceOk::decode(&mut data)?;
				subscriber.recv_subscribe_namespace_ok(msg)?;
			}
			ietf::SubscribeNamespaceError::ID => {
				let msg = ietf::SubscribeNamespaceError::decode(&mut data)?;
				subscriber.recv_subscribe_namespace_error(msg)?;
			}
			ietf::UnsubscribeNamespace::ID => {
				let msg = ietf::UnsubscribeNamespace::decode(&mut data)?;
				publisher.recv_unsubscribe_namespace(msg)?;
			}
			ietf::MaxRequestId::ID => {
				let msg = ietf::MaxRequestId::decode(&mut data)?;
				tracing::warn!(?msg, "ignoring max request id");
			}
			ietf::Fetch::ID => return Err(Error::Unsupported),
			ietf::FetchCancel::ID => return Err(Error::Unsupported),
			ietf::FetchOk::ID => return Err(Error::Unsupported),
			ietf::FetchError::ID => return Err(Error::Unsupported),
			ietf::Publish::ID => return Err(Error::Unsupported),
			ietf::PublishOk::ID => return Err(Error::Unsupported),
			ietf::PublishError::ID => return Err(Error::Unsupported),
			_ => return Err(Error::UnexpectedMessage),
		}

		if !data.is_empty() {
			return Err(Error::WrongSize);
		}
	}
}

async fn run_control_write<S: web_transport_trait::Session + Sync>(
	mut control: Writer<S::SendStream>,
	mut rx: tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>,
) -> Result<(), Error> {
	while let Some(msg) = rx.recv().await {
		let mut buf = std::io::Cursor::new(msg);
		control.write_all(&mut buf).await?;
	}

	Ok(())
}
