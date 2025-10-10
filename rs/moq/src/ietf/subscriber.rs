use std::{
	collections::{hash_map::Entry, HashMap},
	sync::{atomic, Arc},
};

use crate::{
	coding::Reader,
	ietf::{self, Control},
	model::BroadcastProducer,
	Broadcast, Error, Frame, FrameProducer, Group, GroupProducer, OriginProducer, Path, PathOwned, TrackProducer,
};

use web_async::Lock;

#[derive(Clone)]
pub(super) struct Subscriber<S: web_transport_trait::Session> {
	session: S,

	origin: Option<OriginProducer>,
	subscribes: Lock<HashMap<u64, TrackProducer>>,
	next_id: Arc<atomic::AtomicU64>,

	producers: Lock<HashMap<PathOwned, BroadcastProducer>>,
	control: Control,
}

impl<S: web_transport_trait::Session> Subscriber<S> {
	pub fn new(session: S, origin: Option<OriginProducer>, control: Control) -> Self {
		Self {
			session,
			origin,
			subscribes: Default::default(),
			next_id: Default::default(),
			producers: Default::default(),
			control,
		}
	}

	pub fn recv_announce(&mut self, msg: ietf::Announce) -> Result<(), Error> {
		let origin = match &self.origin {
			Some(origin) => origin,
			None => {
				self.control.send(
					ietf::MessageId::AnnounceError,
					ietf::AnnounceError {
						track_namespace: msg.track_namespace,
						error_code: 404,
						reason_phrase: "Publish only".into(),
					},
				)?;

				return Ok(());
			}
		};

		let path = msg.track_namespace.to_owned();
		tracing::debug!(broadcast = %origin.absolute(&path), suffix = %path, "announce");

		let broadcast = Broadcast::produce();

		// Make sure the peer doesn't double announce.
		match self.producers.lock().entry(path.to_owned()) {
			Entry::Occupied(_) => return Err(Error::Duplicate),
			Entry::Vacant(entry) => entry.insert(broadcast.producer.clone()),
		};

		// Run the broadcast in the background until all consumers are dropped.
		self.origin
			.as_mut()
			.unwrap()
			.publish_broadcast(path.clone(), broadcast.consumer);

		self.control.send(
			ietf::MessageId::AnnounceOk,
			ietf::AnnounceOk {
				track_namespace: path.clone(),
			},
		)?;

		web_async::spawn(self.clone().run_broadcast(path, broadcast.producer));

		Ok(())
	}

	pub fn recv_unannounce(&mut self, msg: ietf::Unannounce) -> Result<(), Error> {
		let origin = match &self.origin {
			Some(origin) => origin,
			None => return Ok(()),
		};

		let path = msg.track_namespace.to_owned();
		tracing::debug!(broadcast = %origin.absolute(&path), "unannounced");

		// Close the producer.
		let mut producer = self.producers.lock().remove(&path).ok_or(Error::NotFound)?;

		producer.close();

		Ok(())
	}

	pub fn recv_subscribe_ok(&mut self, _msg: ietf::SubscribeOk) -> Result<(), Error> {
		// Don't care.
		Ok(())
	}

	pub fn recv_subscribe_error(&mut self, msg: ietf::SubscribeError<'_>) -> Result<(), Error> {
		if let Some(track) = self.subscribes.lock().remove(&msg.subscribe_id) {
			track.abort(Error::Cancel);
		}

		Ok(())
	}

	pub fn recv_subscribe_done(&mut self, msg: ietf::SubscribeDone<'_>) -> Result<(), Error> {
		if let Some(track) = self.subscribes.lock().remove(&msg.subscribe_id) {
			track.close();
		}

		Ok(())
	}

	pub async fn run(self) -> Result<(), Error> {
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
			ietf::Group::STREAM_TYPE => self.recv_group(&mut stream).await,
			_ => return Err(Error::UnexpectedStream),
		};

		if let Err(err) = res {
			stream.abort(&err);
		}

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

		self.control
			.send(
				ietf::MessageId::Subscribe,
				ietf::Subscribe {
					subscribe_id: id,
					track_alias: 0,
					track_namespace: broadcast.to_owned(),
					track_name: (&track.info.name).into(),
					subscriber_priority: track.info.priority,
				},
			)
			.ok();

		tracing::info!(id, broadcast = %self.origin.as_ref().unwrap().absolute(&broadcast), track = %track.info.name, "subscribe started");

		track.unused().await;
		tracing::info!(id, broadcast = %self.origin.as_ref().unwrap().absolute(&broadcast), track = %track.info.name, "subscribe cancelled");

		track.abort(Error::Cancel);
	}

	pub async fn recv_group(&mut self, stream: &mut Reader<S::RecvStream>) -> Result<(), Error> {
		let group: ietf::Group = stream.decode().await?;

		let group = {
			let mut subs = self.subscribes.lock();
			let track = subs.get_mut(&group.subscribe_id).ok_or(Error::Cancel)?;

			let group = Group {
				sequence: group.group_id,
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
}
