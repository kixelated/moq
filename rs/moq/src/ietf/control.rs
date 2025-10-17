use std::sync::Arc;

use crate::{
	coding::{self, Encode},
	ietf, Error,
};

#[derive(Clone)]
pub(super) struct Control {
	tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
}

impl Control {
	pub fn new(tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>) -> Self {
		Self { tx }
	}

	pub fn send(&self, id: ietf::MessageId, msg: impl coding::Message) -> Result<(), Error> {
		let mut buf = Vec::new();
		id.encode(&mut buf);
		msg.encode(&mut buf);
		self.tx.send(buf).map_err(|e| Error::Transport(Arc::new(e)))?;
		Ok(())
	}
}
