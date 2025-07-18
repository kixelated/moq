use std::{
	collections::HashMap,
	sync::{atomic, Arc},
};

use crate::{
	message, model::BroadcastProducer, Error, Frame, FrameProducer, Group, GroupProducer, OriginProducer, TrackProducer,
};

use web_async::{spawn, Lock};

use super::{Reader, Stream};

#[derive(Clone)]
pub(super) struct SessionSubscriber {
	session: web_transport::Session,
	origin: Option<OriginProducer>,

	broadcasts: Lock<HashMap<String, BroadcastProducer>>,
	subscribes: Lock<HashMap<u64, TrackProducer>>,
	next_id: Arc<atomic::AtomicU64>,
}

impl SessionSubscriber {
	pub fn new(session: web_transport::Session, origin: Option<OriginProducer>) -> Self {
		Self {
			session,
			origin,
			broadcasts: Default::default(),
			subscribes: Default::default(),
			next_id: Default::default(),
		}
	}

	pub async fn run(self) -> Result<(), Error> {
		// Keep running until we don't care about the producer anymore.
		// TODO Don't clone the origin this many times, it's not needed.
		let closed = match self.origin.clone() {
			Some(origin) => origin,
			None => return Ok(()),
		};

		// Wait until the producer is no longer needed or the stream is closed.
		tokio::select! {
			_ = closed.unused() => Err(Error::Cancel),
			res = self.run_inner() => res,
		}
	}

	async fn run_inner(mut self) -> Result<(), Error> {
		let mut stream = Stream::open(&mut self.session, message::ControlType::Announce).await?;

		let msg = message::AnnounceRequest {
			prefix: self.origin.as_ref().unwrap().prefix.to_string(),
		};
		stream.writer.encode(&msg).await?;

		let mut producers = HashMap::new();

		while let Some(announce) = stream.reader.decode_maybe::<message::Announce>().await? {
			match announce {
				message::Announce::Active { suffix } => {
					tracing::debug!(%suffix, "received announce");

					// Construct absolute path by joining prefix with suffix
					let prefix = &self.origin.as_ref().unwrap().prefix;
					let absolute_path = if suffix.is_empty() {
						prefix.clone()
					} else {
						prefix.join(&suffix)
					};

					let producer = BroadcastProducer::new();
					let consumer = producer.consume();

					// Run the broadcast in the background until all consumers are dropped.
					self.origin.as_mut().unwrap().publish(absolute_path.clone(), consumer);
					producers.insert(suffix.clone(), producer.clone());

					spawn(self.clone().run_broadcast(suffix, producer));
				}
				message::Announce::Ended { suffix } => {
					tracing::debug!(%suffix, "received unannounce");

					// Close the producer.
					let mut producer = producers.remove(&suffix).ok_or(Error::NotFound)?;
					producer.finish();
				}
			}
		}

		// Close the writer.
		stream.writer.finish().await
	}

	async fn run_broadcast(self, name: String, mut broadcast: BroadcastProducer) {
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
			let name = name.clone();
			let mut this = self.clone();

			spawn(async move {
				this.run_subscribe(id, name, track).await;
				this.subscribes.lock().remove(&id);
			});
		}

		// Remove the broadcast from the lookup.
		self.broadcasts.lock().remove(&name);
	}

	async fn run_subscribe(&mut self, id: u64, broadcast: String, track: TrackProducer) {
		self.subscribes.lock().insert(id, track.clone());

		let msg = message::Subscribe {
			id,
			broadcast: broadcast.clone(),
			track: track.info.name.clone(),
			priority: track.info.priority,
		};

		tracing::debug!(%broadcast, track = %track.info.name, id, "subscribe started");

		let res = tokio::select! {
			_ = track.unused() => Err(Error::Cancel),
			res = self.run_track(msg) => res,
		};

		match res {
			Err(Error::Cancel) | Err(Error::WebTransport(_)) => {
				tracing::debug!(broadcast = %broadcast, track = %track.info.name, id, "subscribe cancelled");
				track.abort(Error::Cancel);
			}
			Err(err) => {
				tracing::warn!(?err, broadcast = %broadcast, track = %track.info.name, id, "subscribe error");
				track.abort(err);
			}
			_ => {
				tracing::debug!(broadcast = %broadcast, track = %track.info.name, id, "subscribe complete");
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

		tracing::trace!(group = %group.sequence, "received group");

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
			Err(Error::Cancel) | Err(Error::WebTransport(_)) => {
				tracing::trace!(group = %group.info.sequence, "group cancelled");
				group.abort(Error::Cancel);
			}
			Err(err) => {
				tracing::debug!(?err, group = %group.info.sequence, "group error");
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
		while let Some(frame) = stream.decode_maybe::<message::Frame>().await? {
			let frame = group.create_frame(Frame { size: frame.size });

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
