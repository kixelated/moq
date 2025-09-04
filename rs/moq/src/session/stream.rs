use std::sync::Arc;

use super::{Reader, Writer};
use crate::{message, Error};

pub(super) struct Stream<S: web_transport_trait::Session> {
	pub writer: Writer<S::SendStream>,
	pub reader: Reader<S::RecvStream>,
}

impl<S: web_transport_trait::Session> Stream<S> {
	pub async fn open(session: &S, typ: message::ControlType) -> Result<Self, Error> {
		let (send, recv) = session.open_bi().await.map_err(|err| Error::Transport(Arc::new(err)))?;

		let mut writer = Writer::new(send);
		let reader = Reader::new(recv);
		writer.encode(&typ).await?;

		Ok(Stream { writer, reader })
	}

	pub async fn accept(session: &S) -> Result<Self, Error> {
		let (send, recv) = session
			.accept_bi()
			.await
			.map_err(|err| Error::Transport(Arc::new(err)))?;

		let writer = Writer::new(send);
		let reader = Reader::new(recv);

		Ok(Stream { writer, reader })
	}
}
