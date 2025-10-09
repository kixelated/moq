use std::{collections::HashMap, sync::Arc};

use tokio::sync::oneshot;
use web_async::{FuturesExt, Lock};
use web_transport_trait::SendStream;

use crate::{
	coding::Writer,
	ietf::{self, Control},
	model::GroupConsumer,
	Error, Origin, OriginConsumer, Track, TrackConsumer,
};

#[derive(Clone)]
pub(super) struct Publisher<S: web_transport_trait::Session> {
	session: S,
	origin: OriginConsumer,
	control: Control,
	subscribes: Lock<HashMap<u64, oneshot::Sender<()>>>,
}

impl<S: web_transport_trait::Session> Publisher<S> {
	pub fn new(session: S, origin: Option<OriginConsumer>, control: Control) -> Self {
		// Default to a dummy origin that is immediately closed.
		let origin = origin.unwrap_or_else(|| Origin::produce().consumer);
		Self {
			session,
			origin,
			control,
			subscribes: Default::default(),
		}
	}

	pub async fn run(mut self) -> Result<(), Error> {
		while let Some((path, active)) = self.origin.announced().await {
			let suffix = path.to_owned();

			if active.is_some() {
				tracing::debug!(broadcast = %self.origin.absolute(&path), "announce");
				let msg = ietf::Announce {
					track_namespace: suffix,
				};
				self.control.send(ietf::MessageId::Announce, msg)?;
			} else {
				tracing::debug!(broadcast = %self.origin.absolute(&path), "unannounce");
				let msg = ietf::Unannounce {
					track_namespace: suffix,
				};
				self.control.send(ietf::MessageId::Unannounce, msg)?;
			}
		}

		Ok(())
	}

	pub fn recv_subscribe(&mut self, msg: ietf::Subscribe<'_>) -> Result<(), Error> {
		let id = msg.subscribe_id;

		let track = msg.track_name.clone();
		let absolute = self.origin.absolute(&msg.track_namespace).to_owned();

		tracing::info!(%id, broadcast = %absolute, %track, "subscribed started");

		let broadcast = match self.origin.consume_broadcast(&msg.track_namespace) {
			Some(consumer) => consumer,
			None => {
				self.control.send(
					ietf::MessageId::SubscribeError,
					ietf::SubscribeError {
						subscribe_id: id,
						error_code: 404,
						reason_phrase: "Broadcast not found".into(),
						track_alias: msg.track_alias,
					},
				)?;
				return Ok(());
			}
		};

		let track = Track {
			name: msg.track_name.to_string(),
			priority: msg.subscriber_priority,
		};

		let track = broadcast.subscribe_track(&track);

		let (tx, rx) = oneshot::channel();
		let mut subscribes = self.subscribes.lock();
		subscribes.insert(id, tx);

		self.control.send(
			ietf::MessageId::SubscribeOk,
			ietf::SubscribeOk {
				subscribe_id: id,
				largest: None,
			},
		)?;

		let session = self.session.clone();
		let control = self.control.clone();
		let subscribe_id = msg.subscribe_id;
		let track_alias = msg.track_alias;
		let subscribes = self.subscribes.clone();

		web_async::spawn(async move {
			if let Err(err) = Self::run_track(session, track, subscribe_id, track_alias, rx).await {
				control
					.send(
						ietf::MessageId::SubscribeError,
						ietf::SubscribeError {
							subscribe_id,
							error_code: 500,
							reason_phrase: err.to_string().into(),
							track_alias: msg.track_alias,
						},
					)
					.ok();
			} else {
				control
					.send(
						ietf::MessageId::SubscribeDone,
						ietf::SubscribeDone {
							subscribe_id,
							status_code: 200,
							reason_phrase: "OK".into(),
							final_group_object: None,
						},
					)
					.ok();
			}

			subscribes.lock().remove(&subscribe_id);
		});

		Ok(())
	}

	async fn run_track(
		session: S,
		mut track: TrackConsumer,
		subscribe_id: u64,
		track_alias: u64,
		mut cancel: oneshot::Receiver<()>,
	) -> Result<(), Error> {
		// TODO use a BTreeMap serve the latest N groups by sequence.
		// Until then, we'll implement N=2 manually.
		// Also, this is more complicated because we can't use tokio because of WASM.
		// We need to drop futures in order to cancel them and keep polling them with select!
		let mut old_group = None;
		let mut new_group = None;

		// Annoying that we can't use a tuple here as we need the compiler to infer the type.
		// Otherwise we'd have to pick Send or !Send...
		let mut old_sequence = None;
		let mut new_sequence = None;

		// Keep reading groups from the track, some of which may arrive out of order.
		loop {
			let group = tokio::select! {
				biased;
				_ = &mut cancel => return Err(Error::Cancel),
				Some(group) = track.next_group().transpose() => group,
				Some(_) = async { Some(old_group.as_mut()?.await) } => {
					old_group = None;
					old_sequence = None;
					continue;
				},
				Some(_) = async { Some(new_group.as_mut()?.await) } => {
					new_group = old_group;
					new_sequence = old_sequence;
					old_group = None;
					old_sequence = None;
					continue;
				},
				else => return Ok(()),
			}?;

			let sequence = group.info.sequence;
			let latest = new_sequence.as_ref().unwrap_or(&0);

			tracing::debug!(subscribe = %subscribe_id, track = %track.info.name, sequence, latest, "serving group");

			// If this group is older than the oldest group we're serving, skip it.
			// We always serve at most two groups, but maybe we should serve only sequence >= MAX-1.
			if sequence < *old_sequence.as_ref().unwrap_or(&0) {
				tracing::debug!(subscribe = %subscribe_id, track = %track.info.name, old = %sequence, %latest, "skipping group");
				continue;
			}

			let priority = stream_priority(track.info.priority, sequence);
			let msg = ietf::Group {
				subscribe_id,
				track_alias,
				group_id: sequence,
				publisher_priority: track.info.priority,
			};

			// Spawn a task to serve this group, ignoring any errors because they don't really matter.
			// TODO add some logging at least.
			let handle = Box::pin(Self::run_group(session.clone(), msg, priority, group));

			// Terminate the old group if it's still running.
			if let Some(old_sequence) = old_sequence.take() {
				tracing::debug!(subscribe = %subscribe_id, track = %track.info.name, old = %old_sequence, %latest, "aborting group");
				old_group.take(); // Drop the future to cancel it.
			}

			assert!(old_group.is_none());

			if sequence >= *latest {
				old_group = new_group;
				old_sequence = new_sequence;

				new_group = Some(handle);
				new_sequence = Some(sequence);
			} else {
				old_group = Some(handle);
				old_sequence = Some(sequence);
			}
		}
	}

	async fn run_group(session: S, msg: ietf::Group, priority: i32, mut group: GroupConsumer) -> Result<(), Error> {
		// TODO add a way to open in priority order.
		let mut stream = session
			.open_uni()
			.await
			.map_err(|err| Error::Transport(Arc::new(err)))?;
		stream.set_priority(priority);

		let mut stream = Writer::new(stream);
		stream.encode(&ietf::Group::STREAM_TYPE).await?;
		stream.encode(&msg).await?;

		loop {
			let frame = tokio::select! {
				biased;
				_ = stream.closed() => return Err(Error::Cancel),
				frame = group.next_frame() => frame,
			};

			let mut frame = match frame? {
				Some(frame) => frame,
				None => break,
			};

			tracing::trace!(size = %frame.info.size, "writing frame");

			stream.encode(&frame.info.size).await?;

			loop {
				let chunk = tokio::select! {
					biased;
					_ = stream.closed() => return Err(Error::Cancel),
					chunk = frame.read_chunk() => chunk,
				};

				match chunk? {
					Some(mut chunk) => stream.write_all(&mut chunk).await?,
					None => break,
				}
			}

			tracing::trace!(size = %frame.info.size, "wrote frame");
		}

		stream.finish().await?;

		tracing::debug!(sequence = %msg.group_id, "finished group");

		Ok(())
	}

	pub fn recv_unsubscribe(&mut self, msg: ietf::Unsubscribe) -> Result<(), Error> {
		let mut subscribes = self.subscribes.lock();
		subscribes.remove(&msg.subscribe_id);
		Ok(())
	}

	pub fn recv_announce_ok(&mut self, _msg: ietf::AnnounceOk<'_>) -> Result<(), Error> {
		// We don't care.
		Ok(())
	}

	pub fn recv_subscribe_announces(&mut self, _msg: ietf::SubscribeAnnounces<'_>) -> Result<(), Error> {
		// We don't care, we're sending all announcements anyway.
		Ok(())
	}

	pub fn recv_unsubscribe_announces(&mut self, _msg: ietf::UnsubscribeAnnounces<'_>) -> Result<(), Error> {
		// We don't care, we're sending all announcements anyway.
		Ok(())
	}
}

// Quinn takes a i32 priority.
// We do our best to distill 70 bits of information into 32 bits, but overflows will happen.
// Specifically, group sequence 2^24 will overflow and be incorrectly prioritized.
// But even with a group per frame, it will take ~6 days to reach that point.
// TODO The behavior when two tracks share the same priority is undefined. Should we round-robin?
fn stream_priority(track_priority: u8, group_sequence: u64) -> i32 {
	let sequence = 0xFFFFFF - (group_sequence as u32 & 0xFFFFFF);
	((track_priority as i32) << 24) | sequence as i32
}
