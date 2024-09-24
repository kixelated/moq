use std::collections::{hash_map, HashMap};

use futures::{stream::FuturesUnordered, StreamExt};

use crate::{
	message,
	model::{Broadcast, BroadcastConsumer, GroupConsumer, RouterConsumer, Track, TrackConsumer},
	util::{spawn, FuturesExt, Lock, OrClose},
	Error,
};

use super::{Session, Stream, Writer};

#[derive(Clone)]
pub struct Publisher {
	session: Session,

	// Used to route incoming subscriptions
	broadcasts: Lock<HashMap<String, BroadcastConsumer>>,
	router: Lock<Option<RouterConsumer<Broadcast>>>,
}

impl Publisher {
	pub(crate) fn new(session: Session) -> Self {
		Self {
			session,
			broadcasts: Default::default(),
			router: Default::default(),
		}
	}

	/// Announce a broadcast and serve tracks using the returned [BroadcastProducer].
	#[tracing::instrument("announce", skip_all, err, fields(broadcast = broadcast.name))]
	pub async fn announce(&mut self, broadcast: BroadcastConsumer) -> Result<(), Error> {
		let announce = self.init_announce(broadcast)?;

		let mut stream = self.session.open(message::Stream::Announce).await?;
		self.start_announce(&mut stream, &announce)
			.await
			.or_close(&mut stream)?;

		spawn(async move {
			Self::run_announce(stream, announce).await.ok();
		});

		Ok(())
	}

	fn init_announce(&mut self, broadcast: BroadcastConsumer) -> Result<Announce, Error> {
		match self.broadcasts.lock().entry(broadcast.name.clone()) {
			hash_map::Entry::Occupied(_) => return Err(Error::Duplicate),
			hash_map::Entry::Vacant(entry) => entry.insert(broadcast.clone()),
		};

		Ok(Announce {
			broadcast,
			broadcasts: self.broadcasts.clone(),
		})
	}

	async fn start_announce(&mut self, stream: &mut Stream, announce: &Announce) -> Result<(), Error> {
		let announce = message::Announce {
			broadcast: announce.broadcast.name.clone(),
		};

		stream.writer.encode(&announce).await?;

		let _ok = stream.reader.decode::<message::AnnounceOk>().await?;
		tracing::info!("ok");

		Ok(())
	}

	async fn run_announce(mut stream: Stream, announce: Announce) -> Result<(), Error> {
		tokio::select! {
			// Keep the stream open until the broadcast is closed
			res = stream.reader.closed() => res.map_err(Error::from),
			res = announce.broadcast.closed() => res.map_err(Error::from),
		}
		.or_close(&mut stream)
	}

	// Optionally send any requests for unknown broadcasts to the router
	pub fn route(&mut self, router: RouterConsumer<Broadcast>) {
		*self.router.lock() = Some(router);
	}

	async fn subscribe<B: Into<Broadcast>, T: Into<Track>>(
		&self,
		broadcast: B,
		track: T,
	) -> Result<TrackConsumer, Error> {
		let broadcast = broadcast.into();
		let track = track.into();

		let reader = self.broadcasts.lock().get(&broadcast.name).cloned();
		if let Some(broadcast) = reader {
			tracing::trace!("using announced broadcast");
			return broadcast.subscribe(track).await;
		}

		let router = self.router.lock().clone();
		if let Some(router) = router {
			tracing::trace!("using router");

			let reader = router.subscribe(broadcast).await?;
			return reader.subscribe(track).await;
		}

		Err(Error::NotFound)
	}

	pub(super) async fn recv_subscribe(&mut self, stream: &mut Stream) -> Result<(), Error> {
		let subscribe = stream.reader.decode().await?;
		self.serve_subscribe(stream, subscribe).await
	}

	#[tracing::instrument("subscribed", skip_all, ret, fields(broadcast = subscribe.broadcast, track = subscribe.track, id = subscribe.id))]
	async fn serve_subscribe(&mut self, stream: &mut Stream, subscribe: message::Subscribe) -> Result<(), Error> {
		let track = Track {
			name: subscribe.track,
			priority: subscribe.priority,
			group_expires: subscribe.group_expires,
			group_order: subscribe.group_order,
		};

		let mut track = self.subscribe(subscribe.broadcast, track).await?;

		let info = message::Info {
			group_latest: track.latest_group(),
			group_expires: track.group_expires,
			group_order: track.group_order,
			track_priority: track.priority,
		};

		stream.writer.encode(&info).await?;

		tracing::info!("serving");

		let mut tasks = FuturesUnordered::new();

		loop {
			tokio::select! {
				Some(group) = track.next_group().transpose() => {
					let mut group = group?;
					let session = self.session.clone();

					tasks.push(async move {
						let res = Self::serve_group(session, subscribe.id, &mut group).await;
						(group, res)
					});
				},
				res = stream.reader.decode_maybe::<message::SubscribeUpdate>() => match res? {
					Some(_update) => {
						// TODO use it
					},
					// Subscribe has completed
					None => return Ok(()),
				},
				Some(res) = tasks.next() => {
					let (group, res) = res;

					if let Err(err) = res {
						let drop = message::GroupDrop {
							sequence: group.sequence,
							count: 0,
							code: err.to_code(),
						};

						stream.writer.encode(&drop).await?;
					}
				},
				else => return Ok(()),
			}
		}
	}

	#[tracing::instrument("data", skip_all, ret, fields(group = group.sequence))]
	pub async fn serve_group(mut session: Session, subscribe: u64, group: &mut GroupConsumer) -> Result<(), Error> {
		let mut stream = session.open_uni(message::StreamUni::Group).await?;

		Self::serve_group_inner(subscribe, group, &mut stream)
			.await
			.or_close(&mut stream)
	}

	pub async fn serve_group_inner(
		subscribe: u64,
		group: &mut GroupConsumer,
		stream: &mut Writer,
	) -> Result<(), Error> {
		let msg = message::Group {
			subscribe,
			sequence: group.sequence,
		};

		stream.encode(&msg).await?;

		while let Some(mut frame) = group.next_frame().await? {
			let header = message::Frame { size: frame.size };
			stream.encode(&header).await?;

			let mut remain = frame.size;

			while let Some(chunk) = frame.read().await? {
				remain = remain.checked_sub(chunk.len()).ok_or(Error::WrongSize)?;
				tracing::trace!(chunk = chunk.len(), remain, "chunk");

				stream.write(&chunk).await?;
			}

			if remain > 0 {
				return Err(Error::WrongSize);
			}
		}

		// TODO block until all bytes have been acknowledged so we can still reset
		// writer.finish().await?;

		Ok(())
	}

	pub(super) async fn recv_fetch(&mut self, stream: &mut Stream) -> Result<(), Error> {
		let fetch = stream.reader.decode().await?;
		self.serve_fetch(stream, fetch).await
	}

	#[tracing::instrument("fetch", skip_all, ret, fields(broadcast = fetch.broadcast, track = fetch.track, group = fetch.group, offset = fetch.offset))]
	async fn serve_fetch(&mut self, _stream: &mut Stream, fetch: message::Fetch) -> Result<(), Error> {
		let track = Track::build(fetch.track).priority(fetch.priority);
		let track = self.subscribe(fetch.broadcast, track).await?;
		let _group = track.get_group(fetch.group)?;

		unimplemented!("TODO fetch");
	}

	pub(super) async fn recv_info(&mut self, stream: &mut Stream) -> Result<(), Error> {
		let info = stream.reader.decode().await?;
		self.serve_info(stream, info).await
	}

	#[tracing::instrument("info", skip_all, ret, fields(broadcast = info.broadcast, track = info.track))]
	async fn serve_info(&mut self, stream: &mut Stream, info: message::InfoRequest) -> Result<(), Error> {
		let track = self.subscribe(info.broadcast, info.track).await?;

		let info = message::Info {
			group_latest: track.latest_group(),
			track_priority: track.priority,
			group_expires: track.group_expires,
			group_order: track.group_order,
		};

		stream.writer.encode(&info).await?;

		Ok(())
	}

	pub async fn closed(&self) -> Result<(), Error> {
		self.session.closed().await
	}
}

struct Announce {
	pub broadcast: BroadcastConsumer,
	broadcasts: Lock<HashMap<String, BroadcastConsumer>>,
}

impl Drop for Announce {
	fn drop(&mut self) {
		self.broadcasts.lock().remove(&self.broadcast.name);
	}
}
