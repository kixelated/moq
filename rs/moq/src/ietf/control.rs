use std::sync::{Arc, Mutex};

use tokio::sync::Notify;

use crate::{
	coding::{Encode, Writer},
	ietf::{Message, RequestId},
	Error,
};

struct ControlState {
	request_id_next: RequestId,
	request_id_max: RequestId,
	request_id_notify: Arc<Notify>,
}

#[derive(Clone)]
pub(super) struct Control {
	tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
	state: Arc<Mutex<ControlState>>,
}

impl Control {
	pub fn new(tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>, request_id_max: RequestId, client: bool) -> Self {
		Self {
			tx,
			state: Arc::new(Mutex::new(ControlState {
				request_id_next: if client { RequestId(0) } else { RequestId(1) },
				request_id_max,
				request_id_notify: Arc::new(Notify::new()),
			})),
		}
	}

	pub fn send<T: Message>(&self, msg: T) -> Result<(), Error> {
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

	pub async fn run<S: web_transport_trait::Session>(
		mut stream: Writer<S::SendStream>,
		mut rx: tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>,
	) -> Result<(), Error> {
		while let Some(msg) = rx.recv().await {
			let mut buf = std::io::Cursor::new(msg);
			stream.write_all(&mut buf).await?;
		}

		Ok(())
	}

	pub fn max_request_id(&self, max: RequestId) {
		let mut state = self.state.lock().unwrap();
		state.request_id_max = max;
		state.request_id_notify.notify_waiters();
	}

	pub async fn next_request_id(&self) -> Result<RequestId, Error> {
		loop {
			let notify = {
				let mut state = self.state.lock().unwrap();

				if state.request_id_next < state.request_id_max {
					return Ok(state.request_id_next.increment());
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
