use std::{
	collections::{hash_map::Entry, HashMap},
	sync::Arc,
};

use crate::{
	coding::Reader,
	ietf::{self, Control, FetchHeader, FilterType, GroupFlags, GroupOrder},
	model::BroadcastProducer,
	Broadcast, Error, Frame, FrameProducer, Group, GroupProducer, OriginProducer, Path, PathOwned, TrackProducer,
};

use web_async::Lock;

#[derive(Default)]
struct SubscriberState {
	subscribes: HashMap<u64, SubscriberTrack>,
	aliases: HashMap<u64, u64>,
	broadcasts: HashMap<PathOwned, BroadcastProducer>,
}

struct SubscriberTrack {
	producer: TrackProducer,
	alias: Option<u64>,
}

#[derive(Clone)]
pub(super) struct Subscriber<S: web_transport_trait::Session> {
	session: S,

	origin: Option<OriginProducer>,
	state: Lock<SubscriberState>,
	control: Control,
}

impl<S: web_transport_trait::Session> Subscriber<S> {
	pub fn new(session: S, origin: Option<OriginProducer>, control: Control) -> Self {
		Self {
			session,
			origin,
			state: Default::default(),
			control,
		}
	}

	pub fn recv_publish_namespace(&mut self, msg: ietf::PublishNamespace) -> Result<(), Error> {
		let request_id = msg.request_id;

		let origin = match &self.origin {
			Some(origin) => origin,
			None => {
				self.control.send(ietf::PublishNamespaceError {
					request_id,
					error_code: 404,
					reason_phrase: "Publish only".into(),
				})?;

				return Ok(());
			}
		};

		let path = msg.track_namespace.to_owned();
		tracing::debug!(broadcast = %origin.absolute(&path), "announce");

		let broadcast = Broadcast::produce();

		let mut state = self.state.lock();

		// Make sure the peer doesn't double announce.
		match state.broadcasts.entry(path.to_owned()) {
			Entry::Occupied(_) => return Err(Error::Duplicate),
			Entry::Vacant(entry) => entry.insert(broadcast.producer.clone()),
		};

		// Run the broadcast in the background until all consumers are dropped.
		origin.publish_broadcast(path.clone(), broadcast.consumer);

		self.control.send(ietf::PublishNamespaceOk { request_id })?;

		let mut this = self.clone();
		web_async::spawn(async move {
			if let Err(err) = this.run_broadcast(path.clone(), broadcast.producer).await {
				tracing::debug!(%err, "error running broadcast");
			}
			this.state.lock().broadcasts.remove(&path);
		});

		Ok(())
	}

	pub fn recv_publish_namespace_done(&mut self, msg: ietf::PublishNamespaceDone) -> Result<(), Error> {
		let origin = match &self.origin {
			Some(origin) => origin,
			None => return Ok(()),
		};

		let path = msg.track_namespace.to_owned();
		tracing::debug!(broadcast = %origin.absolute(&path), "unannounced");

		let mut state = self.state.lock();

		// Close the producer.
		let mut producer = state.broadcasts.remove(&path).ok_or(Error::NotFound)?;

		producer.close();

		Ok(())
	}

	pub fn recv_subscribe_ok(&mut self, msg: ietf::SubscribeOk) -> Result<(), Error> {
		// Save the track alias if it's not the same as the request id.
		if msg.request_id != msg.track_alias {
			let mut state = self.state.lock();
			if let Some(subscribe) = state.subscribes.get_mut(&msg.request_id) {
				subscribe.alias = Some(msg.track_alias);
				state.aliases.insert(msg.track_alias, msg.request_id);
			}
		}

		Ok(())
	}

	pub fn recv_subscribe_error(&mut self, msg: ietf::SubscribeError) -> Result<(), Error> {
		let mut state = self.state.lock();

		if let Some(track) = state.subscribes.remove(&msg.request_id) {
			track.producer.abort(Error::Cancel);
			if let Some(alias) = track.alias {
				state.aliases.remove(&alias);
			}
		}

		Ok(())
	}

	pub fn recv_publish_done(&mut self, msg: ietf::PublishDone<'_>) -> Result<(), Error> {
		let mut state = self.state.lock();
		if let Some(track) = state.subscribes.remove(&msg.request_id) {
			track.producer.close();
			if let Some(alias) = track.alias {
				state.aliases.remove(&alias);
			}
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
		let kind: u64 = stream.decode_peek().await?;

		match kind {
			FetchHeader::TYPE => return Err(Error::Unsupported),
			GroupFlags::START..=GroupFlags::END => {}
			_ => return Err(Error::UnexpectedStream),
		}

		if let Err(err) = self.recv_group(&mut stream).await {
			stream.abort(&err);
		}

		Ok(())
	}

	async fn run_broadcast(&mut self, path: Path<'_>, mut broadcast: BroadcastProducer) -> Result<(), Error> {
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

			let request_id = self.control.next_request_id().await?;
			let mut this = self.clone();

			let mut state = self.state.lock();
			state.subscribes.insert(
				request_id,
				SubscriberTrack {
					producer: track.clone(),
					alias: None,
				},
			);

			let path = path.to_owned();
			web_async::spawn(async move {
				if let Err(err) = this.run_subscribe(request_id, path, track).await {
					tracing::debug!(%err, id = %request_id, "error running subscribe");
				}
				this.state.lock().subscribes.remove(&request_id);
			});
		}

		Ok(())
	}

	async fn run_subscribe(&mut self, request_id: u64, broadcast: Path<'_>, track: TrackProducer) -> Result<(), Error> {
		self.control.send(ietf::Subscribe {
			request_id,
			track_namespace: broadcast.to_owned(),
			track_name: (&track.info.name).into(),
			subscriber_priority: track.info.priority,
			group_order: GroupOrder::Descending,
			// we want largest group
			filter_type: FilterType::LargestObject,
		})?;

		// TODO we should send a joining fetch, but it's annoying to implement.
		// We hope instead that publisher start subscriptions at group boundaries.

		tracing::info!(id = %request_id, broadcast = %self.origin.as_ref().unwrap().absolute(&broadcast), track = %track.info.name, "subscribe started");

		track.unused().await;
		tracing::info!(id = %request_id, broadcast = %self.origin.as_ref().unwrap().absolute(&broadcast), track = %track.info.name, "subscribe cancelled");

		track.abort(Error::Cancel);

		Ok(())
	}

	pub async fn recv_group(&mut self, stream: &mut Reader<S::RecvStream>) -> Result<(), Error> {
		let group: ietf::GroupHeader = stream.decode().await?;

		let producer = {
			let mut state = self.state.lock();
			let request_id = *state.aliases.get(&group.track_alias).unwrap_or(&group.track_alias);
			let track = state.subscribes.get_mut(&request_id).ok_or(Error::NotFound)?;

			let group = Group {
				sequence: group.group_id,
			};
			track.producer.create_group(group).ok_or(Error::Old)?
		};

		let res = tokio::select! {
			_ = producer.unused() => Err(Error::Cancel),
			res = self.run_group(group, stream, producer.clone()) => res,
		};

		match res {
			Err(Error::Cancel) | Err(Error::Transport(_)) => {
				tracing::trace!(group = %producer.info.sequence, "group cancelled");
				producer.abort(Error::Cancel);
			}
			Err(err) => {
				tracing::debug!(%err, group = %producer.info.sequence, "group error");
				producer.abort(err);
			}
			_ => {
				tracing::trace!(group = %producer.info.sequence, "group complete");
				producer.close();
			}
		}

		Ok(())
	}

	async fn run_group(
		&mut self,
		group: ietf::GroupHeader,
		stream: &mut Reader<S::RecvStream>,
		mut producer: GroupProducer,
	) -> Result<(), Error> {
		while let Some(id_delta) = stream.decode_maybe::<u64>().await? {
			if id_delta != 0 {
				return Err(Error::Unsupported);
			}

			if group.flags.has_extensions {
				let size: usize = stream.decode().await?;
				stream.skip(size).await?;
			}

			let size: u64 = stream.decode().await?;
			if size == 0 {
				// Have to read the object status.
				let status: u64 = stream.decode().await?;
				if status == 0 {
					// Empty frame
					let frame = producer.create_frame(Frame { size: 0 });
					frame.close();
				} else if status == 3 && !group.flags.has_end {
					// End of group
					break;
				} else {
					return Err(Error::Unsupported);
				}
			} else {
				let frame = producer.create_frame(Frame { size });

				let res = tokio::select! {
					_ = frame.unused() => Err(Error::Cancel),
					res = self.run_frame(stream, frame.clone()) => res,
				};

				if let Err(err) = res {
					frame.abort(err.clone());
					return Err(err);
				}
			}
		}

		producer.close();

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

	pub fn recv_subscribe_namespace_ok(&mut self, _msg: ietf::SubscribeNamespaceOk) -> Result<(), Error> {
		Err(Error::Unsupported)
	}

	pub fn recv_subscribe_namespace_error(&mut self, _msg: ietf::SubscribeNamespaceError<'_>) -> Result<(), Error> {
		Err(Error::Unsupported)
	}

	pub fn recv_fetch_ok(&mut self, _msg: ietf::FetchOk) -> Result<(), Error> {
		Err(Error::Unsupported)
	}

	pub fn recv_fetch_error(&mut self, _msg: ietf::FetchError<'_>) -> Result<(), Error> {
		Err(Error::Unsupported)
	}

	pub fn recv_publish(&mut self, msg: ietf::Publish<'_>) -> Result<(), Error> {
		self.control.send(ietf::PublishError {
			request_id: msg.request_id,
			error_code: 300,
			reason_phrase: "publish not supported bro".into(),
		})
	}
}
