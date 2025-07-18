use web_async::FuturesExt;

use crate::{message, model::GroupConsumer, Error, OriginConsumer, Prefix, Track, TrackConsumer};

use super::{Stream, Writer};

#[derive(Clone)]
pub(super) struct SessionPublisher {
	session: web_transport::Session,
	// If None, then error on every request.
	origin: Option<OriginConsumer>,
}

impl SessionPublisher {
	pub fn new(session: web_transport::Session, origin: Option<OriginConsumer>) -> Self {
		Self { session, origin }
	}

	/*
	pub async fn run(self) -> Result<(), Error> {
		let origin = match self.origin {
			Some(origin) => origin,
			None => return Ok(()),
		};

		// TODO await origin.closed()
	}
	*/

	pub async fn recv_announce(&mut self, stream: &mut Stream) -> Result<(), Error> {
		let interest = stream.reader.decode::<message::AnnounceRequest>().await?;

		let prefix = interest.prefix;

		tracing::trace!(%prefix, "announce started");

		let res = self.run_announce(stream, &prefix).await;
		match res {
			Err(Error::Cancel) => tracing::trace!(%prefix, "announce cancelled"),
			Err(err) => tracing::debug!(?err, %prefix, "announce error"),
			_ => tracing::trace!(%prefix, "announce complete"),
		}

		Ok(())
	}

	async fn run_announce(&mut self, stream: &mut Stream, prefix: &Prefix) -> Result<(), Error> {
		let origin = self.origin.as_ref().ok_or(Error::Unauthorized)?;
		println!("origin: {:?}", origin.prefix);
		println!("prefix: {:?}", prefix);
		println!(
			"prefix.has_prefix(&origin.prefix): {:?}",
			prefix.has_prefix(&origin.prefix)
		);
		println!(
			"prefix.join_prefix(&origin.prefix): {:?}",
			prefix.join_prefix(&origin.prefix)
		);

		// Check if the requested prefix is within the client's authorized prefix
		if !prefix.has_prefix(&origin.prefix) {
			return Err(Error::Unauthorized);
		}

		// prefix of a prefix
		let mut announced = origin.consume_prefix(prefix.clone());

		// Flush any synchronously announced paths
		loop {
			tokio::select! {
				biased;
				res = stream.reader.finished() => return res,
				announced = announced.next() => {
					match announced {
						Some((suffix, broadcast)) => {
							if broadcast.is_some() {
								tracing::debug!(broadcast = %prefix.join(&suffix), "announce");
								let msg = message::Announce::Active { suffix };
								stream.writer.encode(&msg).await?;
							} else {
								tracing::debug!(broadcast = %prefix.join(&suffix), "unannounce");
								let msg = message::Announce::Ended { suffix };
								stream.writer.encode(&msg).await?;
							}
						},
						None => return stream.writer.finish().await,
					}
				}
			}
		}
	}

	pub async fn recv_subscribe(&mut self, stream: &mut Stream) -> Result<(), Error> {
		let mut subscribe = stream.reader.decode::<message::Subscribe>().await?;

		tracing::debug!(id = %subscribe.id, broadcast = %subscribe.broadcast, track = %subscribe.track, "subscribed started");

		let res = self.run_subscribe(stream, &mut subscribe).await;

		match res {
			Err(Error::Cancel) | Err(Error::WebTransport(_)) => {
				tracing::debug!(id = %subscribe.id, broadcast = %subscribe.broadcast, track = %subscribe.track, "subscribed cancelled");
			}
			Err(err) => {
				tracing::warn!(?err, id = %subscribe.id, broadcast = %subscribe.broadcast, track = %subscribe.track, "subscribed error");
			}
			_ => {
				tracing::debug!(id = %subscribe.id, broadcast = %subscribe.broadcast, track = %subscribe.track, "subscribed complete");
			}
		}

		Ok(())
	}

	async fn run_subscribe(&mut self, stream: &mut Stream, subscribe: &mut message::Subscribe) -> Result<(), Error> {
		let origin = self.origin.as_ref().ok_or(Error::Unauthorized)?;

		let suffix = subscribe
			.broadcast
			.strip_prefix(&origin.prefix)
			.ok_or(Error::Unauthorized)?;

		let track = Track {
			name: subscribe.track.clone(),
			priority: subscribe.priority,
		};

		let broadcast = origin.consume(&suffix).ok_or(Error::NotFound)?;
		let track = broadcast.subscribe(&track);

		// TODO wait until track.info() to get the *real* priority

		let info = message::SubscribeOk {
			priority: track.info.priority,
		};

		stream.writer.encode(&info).await?;

		tokio::select! {
			res = self.run_track(track, subscribe) => res?,
			res = stream.reader.finished() => res?,
		}

		stream.writer.finish().await
	}

	async fn run_track(&mut self, mut track: TrackConsumer, subscribe: &mut message::Subscribe) -> Result<(), Error> {
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

			// If this group is older than the oldest group we're serving, skip it.
			// We always serve at most two groups, but maybe we should serve only sequence >= MAX-1.
			if sequence < *old_sequence.as_ref().unwrap_or(&0) {
				tracing::debug!(track = %track.info.name, old = %sequence, %latest, "skipping group");
				continue;
			}

			let priority = Self::stream_priority(track.info.priority, sequence);
			let msg = message::Group {
				subscribe: subscribe.id,
				sequence,
			};

			// Spawn a task to serve this group, ignoring any errors because they don't really matter.
			// TODO add some logging at least.
			let handle = Box::pin(Self::serve_group(self.session.clone(), msg, priority, group));

			// Terminate the old group if it's still running.
			if let Some(old_sequence) = old_sequence.take() {
				tracing::debug!(track = %track.info.name, old = %old_sequence, %latest, "aborting group");
				old_group.take(); // Drop the future to cancel it.
			}

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

	pub async fn serve_group(
		mut session: web_transport::Session,
		msg: message::Group,
		priority: i32,
		mut group: GroupConsumer,
	) -> Result<(), Error> {
		// TODO add a way to open in priority order.
		let mut stream = Writer::open(&mut session, message::DataType::Group).await?;
		stream.set_priority(priority);
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

			let header = message::Frame { size: frame.info.size };
			stream.encode(&header).await?;

			loop {
				let chunk = tokio::select! {
					biased;
					_ = stream.closed() => return Err(Error::Cancel),
					chunk = frame.read() => chunk,
				};

				match chunk? {
					Some(chunk) => stream.write(&chunk).await?,
					None => break,
				}
			}
		}

		stream.finish().await?;

		Ok(())
	}

	// Quinn takes a i32 priority.
	// We do our best to distill 70 bits of information into 32 bits, but overflows will happen.
	// Specifically, group sequence 2^24 will overflow and be incorrectly prioritized.
	// But even with a group per frame, it will take ~6 days to reach that point.
	// TODO The behavior when two tracks share the same priority is undefined. Should we round-robin?
	fn stream_priority(track_priority: u8, group_sequence: u64) -> i32 {
		let sequence = (0xFFFFFF - group_sequence as u32) & 0xFFFFFF;
		((track_priority as i32) << 24) | sequence as i32
	}
}

#[cfg(test)]
mod test {
	use super::*;

	#[test]
	fn stream_priority() {
		let assert = |track_priority, group_sequence, expected| {
			assert_eq!(
				SessionPublisher::stream_priority(track_priority, group_sequence),
				expected
			);
		};

		const U24: i32 = (1 << 24) - 1;

		// NOTE: The lower the value, the higher the priority for Quinn.
		// MoQ does the opposite, so we invert the values.
		assert(0, 50, U24 - 50);
		assert(0, 0, U24);
		assert(1, 50, 2 * U24 - 49);
		assert(1, 0, 2 * U24 + 1);
	}
}
