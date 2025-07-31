use std::collections::VecDeque;

use crate::model::{Frame, GroupConsumer, Timestamp};
use crate::Error;
use futures::{stream::FuturesUnordered, StreamExt};

use moq_lite::coding::*;

/// A producer for media tracks.
///
/// This wraps a `moq_lite::TrackProducer` and adds hang-specific functionality
/// like automatic timestamp encoding and keyframe-based group management.
///
/// ## Group Management
///
/// Groups are automatically created and managed based on keyframes:
/// - When a keyframe is written, the current group is finished and a new one begins.
/// - Non-keyframes are appended to the current group.
/// - Each frame includes a timestamp header for proper playback timing.
#[derive(Clone)]
pub struct TrackProducer {
	pub inner: moq_lite::TrackProducer,
	group: Option<moq_lite::GroupProducer>,
}

impl TrackProducer {
	/// Create a new TrackProducer wrapping the given moq-lite producer.
	pub fn new(inner: moq_lite::TrackProducer) -> Self {
		Self { inner, group: None }
	}

	/// Write a frame to the track.
	///
	/// The frame's timestamp is automatically encoded as a header, and keyframes
	/// trigger the creation of new groups for efficient seeking and caching.
	///
	/// All frames should be in *decode order*.
	///
	/// The timestamp is usually monotonically increasing, but it depends on the encoding.
	/// For example, H.264 B-frames will introduce jitter and reordering.
	pub fn write(&mut self, frame: Frame) {
		let timestamp = frame.timestamp.as_micros() as u64;
		let mut header = BytesMut::new();
		timestamp.encode(&mut header);

		if frame.keyframe {
			if let Some(group) = self.group.take() {
				group.finish();
			}
		}

		let mut group = match self.group.take() {
			Some(group) => group,
			None => self.inner.append(),
		};

		let size = header.len() + frame.payload.len();
		let mut chunked = group.create(size.into());
		chunked.write(header.freeze());
		chunked.write(frame.payload);
		chunked.finish();

		self.group.replace(group);
	}

	/// Create a consumer for this track.
	///
	/// Multiple consumers can be created from the same producer, each receiving
	/// a copy of all data written to the track.
	pub fn consume(&self) -> TrackConsumer {
		TrackConsumer::new(self.inner.consume())
	}
}

impl From<moq_lite::TrackProducer> for TrackProducer {
	fn from(inner: moq_lite::TrackProducer) -> Self {
		Self::new(inner)
	}
}

/// A consumer for hang-formatted media tracks.
///
/// This wraps a `moq_lite::TrackConsumer` and adds hang-specific functionality
/// like timestamp decoding, latency management, and frame buffering.
///
/// ## Latency Management
///
/// The consumer can skip groups that are too far behind to maintain low latency.
/// Use [`set_latency`](Self::set_latency) to configure the maximum acceptable delay.
pub struct TrackConsumer {
	pub inner: moq_lite::TrackConsumer,

	// The current group that we are reading from.
	current: Option<GroupConsumer>,

	// Future groups that we are monitoring, deciding based on [latency] whether to skip.
	pending: VecDeque<GroupConsumer>,

	// The maximum timestamp seen thus far, or zero because that's easier than None.
	max_timestamp: Timestamp,

	// The maximum buffer size before skipping a group.
	latency: std::time::Duration,
}

impl TrackConsumer {
	/// Create a new TrackConsumer wrapping the given moq-lite consumer.
	pub fn new(inner: moq_lite::TrackConsumer) -> Self {
		Self {
			inner,
			current: None,
			pending: VecDeque::new(),
			max_timestamp: Timestamp::default(),
			latency: std::time::Duration::ZERO,
		}
	}

	/// Read the next frame from the track.
	///
	/// This method handles timestamp decoding, group ordering, and latency management
	/// automatically. It will skip groups that are too far behind to maintain the
	/// configured latency target.
	///
	/// Returns `None` when the track has ended.
	pub async fn read(&mut self) -> Result<Option<Frame>, Error> {
		loop {
			let cutoff = self.max_timestamp + self.latency;

			// Keep track of all pending groups, buffering until we detect a timestamp far enough in the future.
			// This is a race; only the first group will succeed.
			// TODO is there a way to do this without FuturesUnordered?
			let mut buffering = FuturesUnordered::new();
			for (index, pending) in self.pending.iter_mut().enumerate() {
				buffering.push(async move { (index, pending.buffer_until(cutoff).await) })
			}

			tokio::select! {
				biased;
				Some(res) = async { Some(self.current.as_mut()?.read().await) } => {
					drop(buffering);

					match res? {
						// Got the next frame.
						Some(frame) => {
							self.max_timestamp = frame.timestamp;
							return Ok(Some(frame));
						}
						None => {
							// Group ended cleanly, instantly move to the next group.
							self.current = self.pending.pop_front();
							continue;
						}
					};
				},
				Some(res) = async { self.inner.next().await.transpose() } => {
					let group = GroupConsumer::new(res?);
					drop(buffering);

					match self.current.as_ref() {
						Some(current) if group.info.sequence < current.info.sequence => {
							// Ignore old groups
							tracing::debug!(old = ?group.info.sequence, current = ?current.info.sequence, "skipping old group");
						},
						Some(_) => {
							// Insert into pending based on the sequence number ascending.
							let index = self.pending.partition_point(|g| g.info.sequence < group.info.sequence);
							self.pending.insert(index, group);
						},
						None => self.current = Some(group),
					};
				},
				Some((index, timestamp)) = buffering.next() => {
					if self.current.is_some() {
						tracing::debug!(old = ?self.max_timestamp, new = ?timestamp, buffer = ?self.latency, "skipping slow group");
					}

					drop(buffering);

					if index > 0 {
						self.pending.drain(0..index);
						tracing::debug!(count = index, "skipping additional groups");
					}

					self.current = self.pending.pop_front();
				}
				else => return Ok(None),
			}
		}
	}

	/// Set the maximum latency tolerance for this consumer.
	///
	/// Groups with timestamps older than `max_timestamp - latency` will be skipped.
	pub fn set_latency(&mut self, max: std::time::Duration) {
		self.latency = max;
	}

	/// Wait until the track is closed.
	pub async fn closed(&self) -> Result<(), Error> {
		Ok(self.inner.closed().await?)
	}
}

impl From<moq_lite::TrackConsumer> for TrackConsumer {
	fn from(inner: moq_lite::TrackConsumer) -> Self {
		Self::new(inner)
	}
}
