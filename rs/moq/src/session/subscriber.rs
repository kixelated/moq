use std::{
	collections::{hash_map::Entry, HashMap},
	sync::{atomic, Arc},
};

use crate::{
	message, model::BroadcastProducer, Broadcast, Error, Frame, FrameProducer, Group, GroupProducer, OriginProducer,
	Path, TrackProducer,
};

use tokio::sync::oneshot;
use web_async::{spawn, Lock};

use super::{Reader, Stream};

#[derive(Clone)]
pub(super) struct Subscriber {
	session: web_transport::Session,

	origin: Option<OriginProducer>,
	broadcasts: Lock<HashMap<Path, BroadcastProducer>>,
	subscribes: Lock<HashMap<u64, TrackProducer>>,
	next_id: Arc<atomic::AtomicU64>,
}

impl Subscriber {
	pub fn new(session: web_transport::Session, origin: Option<OriginProducer>) -> Self {
		Self {
			session,
			origin,
			broadcasts: Default::default(),
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

	async fn run_uni(mut self) -> Result<(), Error> {
		loop {
			let stream = Reader::accept(&mut self.session).await?;
			let this = self.clone();

			web_async::spawn(async move {
				this.run_uni_stream(stream).await.ok();
			});
		}
	}

	async fn run_uni_stream(mut self, mut stream: Reader) -> Result<(), Error> {
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
		let mut origin = match &self.origin {
			// Only ask for announcements matching the prefix.
			Some(origin) => origin.clone(),
			None => {
				// Don't do anything if there's no origin configured.
				let _ = init.send(());
				return Ok(());
			}
		};

		let mut stream = Stream::open(&mut self.session, message::ControlType::Announce).await?;

		let prefix = origin.prefix().to_owned();
		let full = origin.root().join(&prefix);
		tracing::trace!(prefix = %full, "announced start");

		let msg = message::AnnouncePlease { prefix: prefix.clone() };
		stream.writer.encode(&msg).await?;

		let mut producers = HashMap::new();

		let msg: message::AnnounceInit = stream.reader.decode().await?;
		for path in msg.suffixes {
			// Log the full path for easier debugging.
			tracing::debug!(broadcast = %origin.root().join(&prefix).join(&path), "announced");

			let broadcast = Broadcast::produce();

			// Make sure the peer doesn't double announce.
			match producers.entry(path.clone()) {
				Entry::Occupied(_) => return Err(Error::Duplicate),
				Entry::Vacant(entry) => entry.insert(broadcast.producer.clone()),
			};

			origin.publish(&path, broadcast.consumer);

			spawn(self.clone().run_broadcast(path, broadcast.producer));
		}

		let _ = init.send(());

		while let Some(announce) = stream.reader.decode_maybe::<message::Announce>().await? {
			match announce {
				message::Announce::Active { suffix: path } => {
					tracing::debug!(broadcast = %origin.root().join(&prefix).join(&path), "announced");

					let broadcast = Broadcast::produce();

					// Make sure the peer doesn't double announce.
					match producers.entry(path.clone()) {
						Entry::Occupied(_) => return Err(Error::Duplicate),
						Entry::Vacant(entry) => entry.insert(broadcast.producer.clone()),
					};

					// Run the broadcast in the background until all consumers are dropped.
					origin.publish(&path, broadcast.consumer);

					spawn(self.clone().run_broadcast(path, broadcast.producer));
				}
				message::Announce::Ended { suffix: path } => {
					tracing::debug!(broadcast = %origin.root().join(&prefix).join(&path), "unannounced");

					// Close the producer.
					let mut producer = producers.remove(&path).ok_or(Error::NotFound)?;
					producer.finish();
				}
			}
		}

		// Close the stream when there's nothing more to announce.
		stream.writer.finish().await
	}

	async fn run_broadcast(self, path: Path, mut broadcast: BroadcastProducer) {
		// Actually start serving subscriptions.
		loop {
			// Keep serving requests until there are no more consumers.
			// This way we'll clean up the task when the broadcast is no longer needed.
			let track = tokio::select! {
				_ = broadcast.unused() => break,
				producer = broadcast.request() => match producer {
					Some(producer) => producer,
					None => break,
				},
				_ = self.session.closed() => break,
			};

			let id = self.next_id.fetch_add(1, atomic::Ordering::Relaxed);
			let mut this = self.clone();

			let path = path.clone();
			spawn(async move {
				this.run_subscribe(id, path, track).await;
				this.subscribes.lock().remove(&id);
			});
		}

		// Remove the broadcast from the lookup.
		self.broadcasts.lock().remove(&path);
	}

	async fn run_subscribe(&mut self, id: u64, broadcast: Path, track: TrackProducer) {
		let origin = self.origin.as_ref().unwrap();
		let broadcast = origin.prefix().join(&broadcast);
		let full = origin.root().join(&broadcast);

		self.subscribes.lock().insert(id, track.clone());

		let msg = message::Subscribe {
			id,
			broadcast,
			track: track.info.name.clone(),
			priority: track.info.priority,
		};

		tracing::debug!(broadcast = %full, track = %track.info.name, id, "subscribe started");

		let res = tokio::select! {
			_ = track.unused() => Err(Error::Cancel),
			res = self.run_track(msg) => res,
		};

		match res {
			Err(Error::Cancel) | Err(Error::WebTransport(_)) => {
				tracing::debug!(broadcast = %full, track = %track.info.name, id, "subscribe cancelled");
				track.abort(Error::Cancel);
			}
			Err(err) => {
				tracing::warn!(%err, broadcast = %full, track = %track.info.name, id, "subscribe error");
				track.abort(err);
			}
			_ => {
				tracing::debug!(broadcast = %full, track = %track.info.name, id, "subscribe complete");
				track.finish();
			}
		}
	}

	async fn run_track(&mut self, msg: message::Subscribe) -> Result<(), Error> {
		let mut stream = Stream::open(&mut self.session, message::ControlType::Subscribe).await?;

		if let Err(err) = self.run_track_stream(&mut stream, msg).await {
			stream.writer.abort(&err);
			return Err(err);
		}

		stream.writer.finish().await
	}

	async fn run_track_stream(&mut self, stream: &mut Stream, msg: message::Subscribe) -> Result<(), Error> {
		stream.writer.encode(&msg).await?;

		// TODO use the response correctly populate the track info
		let _info: message::SubscribeOk = stream.reader.decode().await?;

		// Wait until the stream is closed
		stream.reader.finished().await?;

		Ok(())
	}

	pub async fn recv_group(&mut self, stream: &mut Reader) -> Result<(), Error> {
		let group: message::Group = stream.decode().await?;

		let group = {
			let mut subs = self.subscribes.lock();
			let track = subs.get_mut(&group.subscribe).ok_or(Error::Cancel)?;

			let group = Group {
				sequence: group.sequence,
			};
			track.create(group).ok_or(Error::Old)?
		};

		let res = tokio::select! {
			_ = group.unused() => Err(Error::Cancel),
			res = self.run_group(stream, group.clone()) => res,
		};

		match res {
			Err(Error::Cancel) | Err(Error::WebTransport(_)) => {
				tracing::trace!(group = %group.info.sequence, "group cancelled");
				group.abort(Error::Cancel);
			}
			Err(err) => {
				tracing::debug!(%err, group = %group.info.sequence, "group error");
				group.abort(err);
			}
			_ => {
				tracing::trace!(group = %group.info.sequence, "group complete");
				group.finish();
			}
		}

		Ok(())
	}

	async fn run_group(&mut self, stream: &mut Reader, mut group: GroupProducer) -> Result<(), Error> {
		while let Some(size) = stream.decode_maybe::<u64>().await? {
			let frame = group.create(Frame { size });

			let res = tokio::select! {
				_ = frame.unused() => Err(Error::Cancel),
				res = self.run_frame(stream, frame.clone()) => res,
			};

			if let Err(err) = res {
				frame.abort(err.clone());
				return Err(err);
			}
		}

		group.finish();

		Ok(())
	}

	async fn run_frame(&mut self, stream: &mut Reader, mut frame: FrameProducer) -> Result<(), Error> {
		let mut remain = frame.info.size;

		while remain > 0 {
			let chunk = stream.read(remain as usize).await?.ok_or(Error::WrongSize)?;
			remain = remain.checked_sub(chunk.len() as u64).ok_or(Error::WrongSize)?;
			frame.write(chunk);
		}

		frame.finish();

		Ok(())
	}
}
