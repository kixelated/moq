use std::{
	collections::{hash_map::Entry, HashMap},
	sync::{atomic, Arc},
};

use crate::{
	message, model::BroadcastProducer, AsPath, Broadcast, Error, Frame, FrameProducer, Group, GroupProducer,
	OriginProducer, Path, PathOwned, TrackProducer,
};

use tokio::sync::oneshot;
use web_async::Lock;

use super::{Reader, Stream};

#[derive(Clone)]
pub(super) struct Subscriber<S: web_transport_trait::Session> {
	session: S,

	origin: Option<OriginProducer>,
	subscribes: Lock<HashMap<u64, TrackProducer>>,
	next_id: Arc<atomic::AtomicU64>,
}

impl<S: web_transport_trait::Session> Subscriber<S> {
	pub fn new(session: S, origin: Option<OriginProducer>) -> Self {
		Self {
			session,
			origin,
			subscribes: Default::default(),
			next_id: Default::default(),
		}
	}

	/// Send a signal when the subscriber is initialized.
	pub async fn run(self, init: oneshot::Sender<()>) -> Result<(), Error> {
		tokio::select! {
			Err(err) = self.clone().run_announce(init) => Err(err),
			res = self.run_uni() => res,
		}
	}

	async fn run_uni(self) -> Result<(), Error> {
		loop {
			let stream = self
				.session
				.accept_uni()
				.await
				.map_err(|err| Error::Transport(Arc::new(err)))?;

			let stream = Reader::new(stream);
			let this = self.clone();

			web_async::spawn(async move {
				if let Err(err) = this.run_uni_stream(stream).await {
					tracing::debug!(%err, "error running uni stream");
				}
			});
		}
	}

	async fn run_uni_stream(mut self, mut stream: Reader<S::RecvStream>) -> Result<(), Error> {
		let kind = stream.decode().await?;

		let res = match kind {
			message::DataType::Group => self.recv_group(&mut stream).await,
		};

		if let Err(err) = res {
			stream.abort(&err);
		}

		Ok(())
	}

	async fn run_announce(mut self, init: oneshot::Sender<()>) -> Result<(), Error> {
		if self.origin.is_none() {
			// Don't do anything if there's no origin configured.
			let _ = init.send(());
			return Ok(());
		}

		let mut stream = Stream::open(&self.session, message::ControlType::Announce).await?;

		tracing::trace!(root = %self.log_path(""), "announced start");

		// Ask for everything.
		// TODO This should actually ask for each root.
		let msg = message::AnnouncePlease { prefix: "".into() };
		stream.writer.encode(&msg).await?;

		let mut producers = HashMap::new();

		let msg: message::AnnounceInit = stream.reader.decode().await?;
		for path in msg.suffixes {
			self.start_announce(path, &mut producers)?;
		}

		let _ = init.send(());

		while let Some(announce) = stream.reader.decode_maybe::<message::Announce>().await? {
			match announce {
				message::Announce::Active { suffix: path } => {
					self.start_announce(path, &mut producers)?;
				}
				message::Announce::Ended { suffix: path } => {
					tracing::debug!(broadcast = %self.log_path(&path), "unannounced");

					// Close the producer.
					let mut producer = producers.remove(&path.into_owned()).ok_or(Error::NotFound)?;
					producer.close();
				}
			}
		}

		// Close the stream when there's nothing more to announce.
		stream.writer.finish().await
	}

	fn start_announce(
		&mut self,
		path: PathOwned,
		producers: &mut HashMap<PathOwned, BroadcastProducer>,
	) -> Result<(), Error> {
		tracing::debug!(broadcast = %self.log_path(&path), suffix = %path, "announced");

		let broadcast = Broadcast::produce();

		// Make sure the peer doesn't double announce.
		match producers.entry(path.to_owned()) {
			Entry::Occupied(_) => return Err(Error::Duplicate),
			Entry::Vacant(entry) => entry.insert(broadcast.producer.clone()),
		};

		// Run the broadcast in the background until all consumers are dropped.
		self.origin
			.as_mut()
			.unwrap()
			.publish_broadcast(path.clone(), broadcast.consumer);

		web_async::spawn(self.clone().run_broadcast(path, broadcast.producer));

		Ok(())
	}

	async fn run_broadcast(self, path: PathOwned, mut broadcast: BroadcastProducer) {
		// Actually start serving subscriptions.
		loop {
			// Keep serving requests until there are no more consumers.
			// This way we'll clean up the task when the broadcast is no longer needed.
			let track = tokio::select! {
				_ = broadcast.unused() => break,
				producer = broadcast.requested_track() => match producer {
					Some(producer) => producer,
					None => break,
				},
				_ = self.session.closed() => break,
			};

			let id = self.next_id.fetch_add(1, atomic::Ordering::Relaxed);
			let mut this = self.clone();

			let path = path.clone();
			web_async::spawn(async move {
				this.run_subscribe(id, path, track).await;
				this.subscribes.lock().remove(&id);
			});
		}
	}

	async fn run_subscribe(&mut self, id: u64, broadcast: Path<'_>, track: TrackProducer) {
		self.subscribes.lock().insert(id, track.clone());

		let msg = message::Subscribe {
			id,
			broadcast: broadcast.to_owned(),
			track: (&track.info.name).into(),
			priority: track.info.priority,
		};

		tracing::debug!(broadcast = %self.log_path(&broadcast), track = %track.info.name, id, "subscribe started");

		let res = tokio::select! {
			_ = track.unused() => Err(Error::Cancel),
			res = self.run_track(msg) => res,
		};

		match res {
			Err(Error::Cancel) | Err(Error::Transport(_)) => {
				tracing::debug!(broadcast = %self.log_path(&broadcast), track = %track.info.name, id, "subscribe cancelled");
				track.abort(Error::Cancel);
			}
			Err(err) => {
				tracing::warn!(%err, broadcast = %self.log_path(&broadcast), track = %track.info.name, id, "subscribe error");
				track.abort(err);
			}
			_ => {
				tracing::debug!(broadcast = %self.log_path(&broadcast), track = %track.info.name, id, "subscribe complete");
				track.close();
			}
		}
	}

	async fn run_track(&mut self, msg: message::Subscribe<'_>) -> Result<(), Error> {
		let mut stream = Stream::open(&self.session, message::ControlType::Subscribe).await?;

		if let Err(err) = self.run_track_stream(&mut stream, msg).await {
			stream.writer.abort(&err);
			return Err(err);
		}

		stream.writer.finish().await
	}

	async fn run_track_stream(&mut self, stream: &mut Stream<S>, msg: message::Subscribe<'_>) -> Result<(), Error> {
		stream.writer.encode(&msg).await?;

		// TODO use the response correctly populate the track info
		let _info: message::SubscribeOk = stream.reader.decode().await?;

		// Wait until the stream is closed
		stream.reader.closed().await?;

		Ok(())
	}

	pub async fn recv_group(&mut self, stream: &mut Reader<S::RecvStream>) -> Result<(), Error> {
		let group: message::Group = stream.decode().await?;

		let group = {
			let mut subs = self.subscribes.lock();
			let track = subs.get_mut(&group.subscribe).ok_or(Error::Cancel)?;

			let group = Group {
				sequence: group.sequence,
			};
			track.create_group(group).ok_or(Error::Old)?
		};

		let res = tokio::select! {
			_ = group.unused() => Err(Error::Cancel),
			res = self.run_group(stream, group.clone()) => res,
		};

		match res {
			Err(Error::Cancel) | Err(Error::Transport(_)) => {
				tracing::trace!(group = %group.info.sequence, "group cancelled");
				group.abort(Error::Cancel);
			}
			Err(err) => {
				tracing::debug!(%err, group = %group.info.sequence, "group error");
				group.abort(err);
			}
			_ => {
				tracing::trace!(group = %group.info.sequence, "group complete");
				group.close();
			}
		}

		Ok(())
	}

	async fn run_group(&mut self, stream: &mut Reader<S::RecvStream>, mut group: GroupProducer) -> Result<(), Error> {
		while let Some(size) = stream.decode_maybe::<u64>().await? {
			let frame = group.create_frame(Frame { size });

			let res = tokio::select! {
				_ = frame.unused() => Err(Error::Cancel),
				res = self.run_frame(stream, frame.clone()) => res,
			};

			if let Err(err) = res {
				frame.abort(err.clone());
				return Err(err);
			}
		}

		group.close();

		Ok(())
	}

	async fn run_frame(&mut self, stream: &mut Reader<S::RecvStream>, mut frame: FrameProducer) -> Result<(), Error> {
		let mut remain = frame.info.size;

		tracing::trace!(size = %frame.info.size, "reading frame");

		while remain > 0 {
			let chunk = stream.read(remain as usize).await?.ok_or(Error::WrongSize)?;
			remain = remain.checked_sub(chunk.len() as u64).ok_or(Error::WrongSize)?;
			frame.write_chunk(chunk);
		}

		tracing::trace!(size = %frame.info.size, "read frame");

		frame.close();

		Ok(())
	}

	fn log_path(&self, path: impl AsPath) -> Path {
		self.origin.as_ref().unwrap().root().join(path)
	}
}
