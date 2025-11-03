use std::sync::{Arc, Mutex};

use tokio::sync::Notify;

use crate::{coding::Encode, ietf::Message, Error};

struct ControlState {
	request_id_next: u64,
	request_id_max: u64,
	request_id_notify: Arc<Notify>,
}

#[derive(Clone)]
pub(super) struct Control {
	tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
	state: Arc<Mutex<ControlState>>,
}

impl Control {
	pub fn new(tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>, request_id_max: u64, client: bool) -> Self {
		Self {
			tx,
			state: Arc::new(Mutex::new(ControlState {
				request_id_next: if client { 0 } else { 1 },
				request_id_max,
				request_id_notify: Arc::new(Notify::new()),
			})),
		}
	}

	pub fn send<T: Message + std::fmt::Debug>(&self, msg: T) -> Result<(), Error> {
		tracing::debug!(message = ?msg, "sending control message");

		let mut buf = Vec::new();
		T::ID.encode(&mut buf);
		// TODO Always encode 2 bytes for the size, then go back and populate it later.
		// That way we can avoid calculating the size upfront.
		msg.encode_size().encode(&mut buf);
		msg.encode(&mut buf);

		self.tx.send(buf).map_err(|e| Error::Transport(Arc::new(e)))?;
		Ok(())
	}

	pub fn max_request_id(&self, max: u64) {
		let mut state = self.state.lock().unwrap();
		state.request_id_max = max;
		state.request_id_notify.notify_waiters();
	}

	pub async fn next_request_id(&self) -> Result<u64, Error> {
		loop {
			let notify = {
				let mut state = self.state.lock().unwrap();

				if state.request_id_next < state.request_id_max {
					let next = state.request_id_next;
					state.request_id_next += 2;
					return Ok(next);
				}

				state.request_id_notify.clone().notified_owned()
			};

			tokio::select! {
				_ = notify => continue,
				_ = self.tx.closed() => return Err(Error::Cancel),
			}
		}
	}
}
