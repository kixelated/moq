use std::sync::{atomic, Arc};

use crate::{coding::Encode, ietf::Message, Error};

#[derive(Clone)]
pub(super) struct Control {
	tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
	request_id: Arc<atomic::AtomicU64>,
}

impl Control {
	pub fn new(tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>, client: bool) -> Self {
		Self {
			tx,
			request_id: Arc::new(atomic::AtomicU64::new(if client { 0 } else { 1 })),
		}
	}

	pub fn send<T: Message>(&self, msg: T) -> Result<(), Error> {
		let mut buf = Vec::new();
		T::ID.encode(&mut buf);
		// TODO Always encode 2 bytes for the size, then go back and populate it later.
		// That way we can avoid calculating the size upfront.
		msg.encode_size().encode(&mut buf);
		msg.encode(&mut buf);

		self.tx.send(buf).map_err(|e| Error::Transport(Arc::new(e)))?;
		Ok(())
	}

	pub fn request_id(&self) -> u64 {
		self.request_id.fetch_add(2, atomic::Ordering::Relaxed)
	}
}
