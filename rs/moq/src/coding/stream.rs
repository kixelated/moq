use std::sync::Arc;

use crate::coding::{Reader, Writer};
use crate::Error;

pub struct Stream<S: web_transport_trait::Session> {
	pub writer: Writer<S::SendStream>,
	pub reader: Reader<S::RecvStream>,
}

impl<S: web_transport_trait::Session> Stream<S> {
	pub async fn open(session: &S) -> Result<Self, Error> {
		let (send, recv) = session.open_bi().await.map_err(|err| Error::Transport(Arc::new(err)))?;

		let writer = Writer::new(send);
		let reader = Reader::new(recv);

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
