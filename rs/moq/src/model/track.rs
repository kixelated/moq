//! A track is a collection of semi-reliable and semi-ordered streams, split into a [TrackProducer] and [TrackConsumer] handle.
//!
//! A [TrackProducer] creates streams with a sequence number and priority.
//! The sequest number is used to determine the order of streams, while the priority is used to determine which stream to transmit first.
//! This may seem counter-intuitive, but is designed for live streaming where the newest streams may be higher priority.
//! A cloned [Producer] can be used to create streams in parallel, but will error if a duplicate sequence number is used.
//!
//! A [TrackConsumer] may not receive all streams in order or at all.
//! These streams are meant to be transmitted over congested networks and the key to MoQ Tranport is to not block on them.
//! streams will be cached for a potentially limited duration added to the unreliable nature.
//! A cloned [Consumer] will receive a copy of all new stream going forward (fanout).
//!
//! The track is closed with [Error] when all writers or readers are dropped.

use futures::StreamExt;
use tokio::sync::watch;

use crate::{Error, Produce, Result};

use super::{Group, GroupConsumer, GroupProducer};

use std::{
	collections::{HashSet, VecDeque},
	future::Future,
};

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Track {
	pub name: String,
	pub priority: u8,

	/// This group will expire this duration after a newer group is created.
	pub expires: std::time::Duration,
}

impl Track {
	pub fn new<T: Into<String>>(name: T) -> Self {
		Self {
			name: name.into(),
			priority: 0,
			expires: std::time::Duration::default(),
		}
	}

	pub fn produce(self) -> Produce<TrackProducer, TrackConsumer> {
		let producer = TrackProducer::new(self);
		let consumer = producer.consume();
		Produce { producer, consumer }
	}
}

#[derive(Default)]
struct TrackState {
	// Store each group along with the time it was created.
	// This is in creation order, not sequence order, so groups can expire out of order.
	// I still make it a VecDeque because we almost always expire from the front.
	groups: VecDeque<(GroupConsumer, tokio::time::Instant)>,
	// Store the next sequence number to use for append_group
	next: u64,
	closed: Option<Result<()>>,
}

impl TrackState {
	fn insert_group(&mut self, group: GroupProducer, mut expires: std::time::Duration) -> Result<std::time::Duration> {
		// If the track is closed, return an error.
		match &self.closed {
			Some(Err(err)) => return Err(err.clone()),
			Some(Ok(_)) => return Err(Error::Closed),
			None => (),
		};

		assert!(
			!self
				.groups
				.iter()
				.any(|(other, _)| other.info.sequence == group.info.sequence),
			"group already exists"
		);

		// Calculate the expiration time for this group
		// Basically we find the first group we received that is newer than this one, and subtract the elapsed time.
		// This means we can expire super old groups immediately.
		let newest = self
			.groups
			.iter()
			.filter(|(other, _)| other.info.sequence > group.info.sequence)
			.map(|(_, when)| when)
			.min();

		if let Some(newest) = newest {
			// Subtract the elapsed time from the expiration time.
			expires = expires.saturating_sub(newest.elapsed());

			// Already expired, so don't create it.
			if expires.is_zero() {
				return Err(Error::Expired);
			}
		} else {
			// There's no larger sequence number, so this is the latest group.
			// Update next_sequence to be one past this sequence.
			self.next = group.info.sequence + 1;
		}

		self.groups.push_back((group.consume(), tokio::time::Instant::now()));

		Ok(expires)
	}

	fn create_group(
		&mut self,
		group: Group,
		expires: std::time::Duration,
	) -> Result<(GroupProducer, std::time::Duration)> {
		let group = group.produce();
		let expires = self.insert_group(group.producer.clone(), expires)?;
		Ok((group.producer, expires))
	}

	// Same logic as create_group but simpler because it is always the latest group.
	fn append_group(&mut self) -> Result<GroupProducer> {
		// If the track is closed, return an error.
		match &self.closed {
			Some(Err(err)) => return Err(err.clone()),
			Some(Ok(_)) => return Err(Error::Closed),
			None => (),
		};

		let sequence = self.next;
		self.next += 1;
		let group = Group { sequence }.produce();
		self.groups.push_back((group.consumer, tokio::time::Instant::now()));

		Ok(group.producer)
	}

	fn close(&mut self) -> Result<()> {
		if let Some(Err(err)) = &self.closed {
			return Err(err.clone());
		}

		self.closed = Some(Ok(()));
		Ok(())
	}
}

/// A producer for a track, used to create new groups.
#[derive(Clone)]
pub struct TrackProducer {
	pub info: Track,
	state: watch::Sender<TrackState>,
}

impl TrackProducer {
	fn new(info: Track) -> Self {
		Self {
			info,
			state: Default::default(),
		}
	}

	/// Insert an existing group into the track.
	///
	/// This is used to insert a group that was received from the network.
	/// The group will be closed with [Error::Expired] if it is active too long.
	pub fn insert_group(&mut self, group: GroupProducer) -> Result<()> {
		let mut result = Err(Error::Closed); // We will replace this.

		let producer = group.clone();
		self.state.send_if_modified(|state| {
			result = state.insert_group(producer, self.info.expires);
			result.is_ok()
		});

		let expires = result?;
		web_async::spawn(self.clone().expire(group, expires));
		Ok(())
	}

	/// Create a new group with the given sequence number.
	///
	/// The group will be closed with [Error::Expired] if it is active too long.
	pub fn create_group(&mut self, info: Group) -> Result<GroupProducer> {
		let mut result = Err(Error::Closed); // We will replace this.

		self.state.send_if_modified(|state| {
			result = state.create_group(info, self.info.expires);
			result.is_ok()
		});

		let (producer, expires) = result?;
		web_async::spawn(self.clone().expire(producer.clone(), expires));
		Ok(producer)
	}

	/// Create a new group with the next sequence number.
	///
	/// The group will eventually be closed with [Error::Expired] if active too long.
	pub fn append_group(&mut self) -> Result<GroupProducer> {
		let mut result = Err(Error::Closed); // We will replace this.

		self.state.send_if_modified(|state| {
			result = state.append_group();
			result.is_ok()
		});

		let producer = result?;
		web_async::spawn(self.clone().expire(producer.clone(), self.info.expires));
		Ok(producer)
	}

	/// A helper to create a group with a single frame.
	pub fn write_frame<B: Into<bytes::Bytes>>(&mut self, frame: B) -> Result<()> {
		let mut group = self.append_group()?;
		group.write_frame(frame.into()).unwrap();
		group.close().unwrap();
		Ok(())
	}

	/// Proxy all groups and errors from the given consumer.
	///
	/// This takes ownership of the track and publishes identical groups to the other consumer.
	/// Unfortunately, this is required to set a shorter expiration time for the proxy.
	pub async fn proxy(mut self, other: TrackConsumer) -> Result<()> {
		let mut groups = Some(other.clone());
		let mut tasks = futures::stream::FuturesUnordered::new();

		loop {
			tokio::select! {
				biased;
				Some(group) = async { Some(groups.as_mut()?.next_group().await) } => {
					match group {
						Ok(Some(group)) => {
							let producer = self.create_group(group.info.clone())?;
							tasks.push(producer.proxy(group));
						}
						Ok(None) => {
							groups = None;
							self.close()?;
						}
						Err(err) => {
							self.abort(err.clone());
							return Err(err);
						}
					}
				}
				Err(err) = other.closed() => {
					self.abort(err);
					return Ok(());
				}
				Some(_) = tasks.next() => {}
				else => return Ok(()),
			}
		}
	}

	pub fn close(&mut self) -> Result<()> {
		let mut result = Ok(());

		self.state.send_if_modified(|state| {
			result = state.close();
			result.is_ok()
		});

		result
	}

	pub fn abort(&mut self, err: Error) {
		self.state.send_modify(|state| state.closed = Some(Err(err)));
	}

	/// Create a new consumer for the track.
	pub fn consume(&self) -> TrackConsumer {
		TrackConsumer {
			info: self.info.clone(),
			state: self.state.subscribe(),
			seen: Default::default(),
		}
	}

	/// Block until there are no active consumers.
	pub fn unused(&self) -> impl Future<Output = ()> {
		let state = self.state.clone();
		async move {
			state.closed().await;
		}
	}

	/// Return true if this is the same track.
	pub fn is_clone(&self, other: &Self) -> bool {
		self.state.same_channel(&other.state)
	}

	async fn expire(self, mut group: GroupProducer, expires: std::time::Duration) {
		let consumer = group.consume();
		let mut state = self.state.subscribe();

		let sequence = group.info.sequence;

		tokio::select! {
			// Abort early if the group is aborted.
			_ = consumer.aborted() => (),
			_ = async {
				// Wait until this group is no longer the latest group.
				let closed = state
					.wait_for(|state| state.closed.is_some() || state.next > sequence + 1)
					.await.unwrap().closed.clone();

				match closed {
					Some(Err(err)) => group.abort(err),
					_ => {
						// Start the timer to expire the group.
						tokio::time::sleep(expires).await;

						// Expire the group.
						group.abort(Error::Expired);
					}
				};

			} => (),
		};

		// Remove the group from the list of active groups.
		self.state.send_if_modified(|state| {
			state.groups.retain(|(active, _)| active.info.sequence != sequence);
			false
		});
	}
}

impl From<Track> for TrackProducer {
	fn from(info: Track) -> Self {
		TrackProducer::new(info)
	}
}

/// A consumer for a track, used to read groups.
///
/// NOTE: [Self::clone] remembers all of the groups returned from [Self::next_group].
#[derive(Clone)]
pub struct TrackConsumer {
	pub info: Track,
	state: watch::Receiver<TrackState>,

	// Record groups that we have already returned.
	seen: HashSet<u64>,
}

impl TrackConsumer {
	/// Receive the next group over the network.
	///
	/// NOTE: This can return groups out of order, or with gaps, if there is queueing or network slowdowns.
	pub async fn next_group(&mut self) -> Result<Option<GroupConsumer>> {
		// Wait until there's a new latest group or the track is closed.
		let state = match self
			.state
			.wait_for(|state| {
				// Check if we've seen the last element in the queue.
				if let Some((last, _)) = state.groups.back() {
					if !self.seen.contains(&last.info.sequence) {
						return true;
					}
				}
				// Otherwise, check if the track is closed.
				state.closed.is_some()
			})
			.await
		{
			Ok(state) => state,
			Err(_) => return Err(Error::Cancel),
		};

		if let Some(Err(err)) = &state.closed {
			return Err(err.clone());
		}

		// Periodically clean up the seen set to only include groups that are still active.
		if self.seen.len() > 4 * state.groups.len() {
			self.seen
				.retain(|sequence| state.groups.iter().any(|(group, _)| group.info.sequence == *sequence));
		}

		// If there's a new latest group, return it.
		for (group, _) in state.groups.iter() {
			if !self.seen.contains(&group.info.sequence) {
				self.seen.insert(group.info.sequence);
				return Ok(Some(group.clone()));
			}
		}

		state.closed.clone().expect("should be closed").map(|_| None)
	}

	/// Create a new consumer with a more strict expiration time.
	pub fn expires(self, expires: std::time::Duration) -> Self {
		if expires >= self.info.expires {
			return self;
		}

		// Ugh create a new producer and proxy the state.
		let proxied = Track {
			name: self.info.name.clone(),
			priority: self.info.priority,
			expires,
		}
		.produce();

		web_async::spawn(async move {
			if let Err(err) = proxied.producer.proxy(self).await {
				tracing::warn!(?err, "failed to proxy track");
			}
		});

		proxied.consumer
	}

	/// Block until the track is closed.
	pub async fn closed(&self) -> Result<()> {
		match self.state.clone().wait_for(|state| state.closed.is_some()).await {
			Ok(state) => state.closed.clone().unwrap(),
			Err(_) => Err(Error::Cancel),
		}
	}

	pub fn is_clone(&self, other: &Self) -> bool {
		self.state.same_channel(&other.state)
	}
}

#[cfg(test)]
use futures::FutureExt;

#[cfg(test)]
impl TrackConsumer {
	pub fn assert_group(&mut self) -> GroupConsumer {
		self.next_group()
			.now_or_never()
			.expect("group would have blocked")
			.expect("would have errored")
			.expect("track was closed")
	}

	pub fn assert_no_group(&mut self) {
		assert!(
			self.next_group().now_or_never().is_none(),
			"next group would not have blocked"
		);
	}

	pub fn assert_not_closed(&self) {
		assert!(self.closed().now_or_never().is_none(), "should not be closed");
	}

	pub fn assert_closed(&self) {
		assert!(self.closed().now_or_never().is_some(), "should be closed");
	}

	// TODO assert specific errors after implementing PartialEq
	pub fn assert_error(&self) {
		assert!(
			self.closed().now_or_never().expect("should not block").is_err(),
			"should be error"
		);
	}

	pub fn assert_is_clone(&self, other: &Self) {
		assert!(self.is_clone(other), "should be clone");
	}

	pub fn assert_not_clone(&self, other: &Self) {
		assert!(!self.is_clone(other), "should not be clone");
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use bytes::Bytes;
	use std::time::Duration;

	#[tokio::test]
	async fn test_track_basic_write_read() {
		let track = Track::new("test").produce();
		let mut producer = track.producer;
		let mut consumer = track.consumer;

		let mut g1 = producer.append_group().unwrap();
		g1.write_frame(&b"frame1"[..]).unwrap();
		g1.close().unwrap();

		let mut g2 = producer.append_group().unwrap();
		g2.write_frame(&b"frame2"[..]).unwrap();
		g2.close().unwrap();

		producer.close().unwrap();

		let mut group1 = consumer.next_group().await.unwrap().unwrap();
		assert_eq!(group1.info.sequence, 0);
		let f1 = group1.read_frame().await.unwrap().unwrap();
		assert_eq!(f1, Bytes::from_static(b"frame1"));

		let mut group2 = consumer.next_group().await.unwrap().unwrap();
		assert_eq!(group2.info.sequence, 1);
		let f2 = group2.read_frame().await.unwrap().unwrap();
		assert_eq!(f2, Bytes::from_static(b"frame2"));

		let none = consumer.next_group().await;
		assert!(none.unwrap().is_none());
	}

	#[tokio::test]
	async fn test_track_write_frame_helper() {
		let track = Track::new("test").produce();
		let mut producer = track.producer;
		let mut consumer = track.consumer;

		producer.write_frame(&b"frame1"[..]).unwrap();
		producer.write_frame(&b"frame2"[..]).unwrap();
		producer.close().unwrap();

		let mut group1 = consumer.next_group().await.unwrap().unwrap();
		let f1 = group1.read_frame().await.unwrap().unwrap();
		assert_eq!(f1, Bytes::from_static(b"frame1"));

		let mut group2 = consumer.next_group().await.unwrap().unwrap();
		let f2 = group2.read_frame().await.unwrap().unwrap();
		assert_eq!(f2, Bytes::from_static(b"frame2"));
	}

	#[tokio::test(start_paused = true)]
	async fn test_track_create_group() {
		let mut track_info = Track::new("test");
		track_info.expires = Duration::from_secs(10); // Long expiration so nothing expires
		let track = track_info.produce();
		let mut producer = track.producer;
		let mut consumer = track.consumer;

		let mut g1 = producer.create_group(Group { sequence: 5 }).unwrap();
		g1.write_frame(&b"frame1"[..]).unwrap();
		g1.close().unwrap();

		let mut g2 = producer.create_group(Group { sequence: 3 }).unwrap();
		g2.write_frame(&b"frame2"[..]).unwrap();
		g2.close().unwrap();

		producer.close().unwrap();

		// Groups can arrive out of order
		let group1 = consumer.next_group().await.unwrap().unwrap();
		assert_eq!(group1.info.sequence, 5);

		let group2 = consumer.next_group().await.unwrap().unwrap();
		assert_eq!(group2.info.sequence, 3);
	}

	#[tokio::test]
	async fn test_track_abort() {
		let track = Track::new("test").produce();
		let mut producer = track.producer;
		let consumer = track.consumer;

		producer.write_frame(&b"frame1"[..]).unwrap();
		producer.abort(Error::Expired);

		let result = consumer.closed().await;
		assert!(result.is_err());
	}

	#[tokio::test]
	async fn test_track_multiple_consumers() {
		let track = Track::new("test").produce();
		let mut producer = track.producer;
		let mut consumer1 = track.consumer.clone();
		let mut consumer2 = track.consumer;

		producer.write_frame(&b"frame1"[..]).unwrap();
		producer.write_frame(&b"frame2"[..]).unwrap();
		producer.close().unwrap();

		// Both consumers should receive all groups
		let mut g1_c1 = consumer1.next_group().await.unwrap().unwrap();
		let mut g2_c1 = consumer1.next_group().await.unwrap().unwrap();
		let mut g1_c2 = consumer2.next_group().await.unwrap().unwrap();
		let mut g2_c2 = consumer2.next_group().await.unwrap().unwrap();

		let f1_c1 = g1_c1.read_frame().await.unwrap().unwrap();
		let f2_c1 = g2_c1.read_frame().await.unwrap().unwrap();
		let f1_c2 = g1_c2.read_frame().await.unwrap().unwrap();
		let f2_c2 = g2_c2.read_frame().await.unwrap().unwrap();

		assert_eq!(f1_c1, Bytes::from_static(b"frame1"));
		assert_eq!(f2_c1, Bytes::from_static(b"frame2"));
		assert_eq!(f1_c2, Bytes::from_static(b"frame1"));
		assert_eq!(f2_c2, Bytes::from_static(b"frame2"));
	}

	#[tokio::test(start_paused = true)]
	async fn test_track_expiration() {
		let mut track_info = Track::new("test");
		track_info.expires = Duration::from_millis(300);
		let track = track_info.produce();
		let mut producer = track.producer;
		let mut consumer = track.consumer;

		// Create group 0 at t=0
		let mut g0 = producer.append_group().unwrap();
		g0.write_frame(&b"old"[..]).unwrap();
		g0.close().unwrap();

		// Advance time by 100ms
		tokio::time::sleep(Duration::from_millis(100)).await;

		// Create group 1 at t=100ms
		// This starts the expiration timer for group 0
		// Group 0 should expire at t=100ms + 300ms = t=400ms
		let mut g1 = producer.append_group().unwrap();
		g1.write_frame(&b"new"[..]).unwrap();
		g1.close().unwrap();

		// Get group 0
		let mut group0 = consumer.next_group().await.unwrap().unwrap();
		assert_eq!(group0.info.sequence, 0);

		// At t=100ms, group 0 should still be available
		// Advance to t=350ms (250ms after group 1 was created)
		tokio::time::sleep(Duration::from_millis(250)).await;
		let frame = group0.read_frame().await.unwrap().unwrap();
		assert_eq!(frame, Bytes::from_static(b"old"));

		// Advance to t=450ms (past the expiration time of t=400ms)
		tokio::time::sleep(Duration::from_millis(100)).await;

		// Group 0 should be aborted now
		let result = group0.closed().await;
		assert!(result.is_err());
	}

	#[tokio::test(start_paused = true)]
	async fn test_track_expiration_immediate() {
		let mut track_info = Track::new("test");
		track_info.expires = Duration::from_millis(100);
		let track = track_info.produce();
		let mut producer = track.producer;

		// Create group 2 at t=0 (latest group)
		let mut g2 = producer.create_group(Group { sequence: 2 }).unwrap();
		g2.write_frame(&b"latest"[..]).unwrap();
		g2.close().unwrap();

		// Advance time by 150ms (past expiration)
		tokio::time::sleep(Duration::from_millis(150)).await;

		// Try to insert an old group (sequence 0)
		// It was created 150ms after group 2, and group 2 is newer
		// So this group should expire immediately (already past the 100ms expiration)
		let old_group = Group { sequence: 0 }.produce();
		let result = producer.insert_group(old_group.producer);
		assert!(result.is_err());
	}

	#[tokio::test(start_paused = true)]
	async fn test_track_out_of_order() {
		let mut track_info = Track::new("test");
		track_info.expires = Duration::from_secs(10); // Long expiration so nothing expires
		let track = track_info.produce();
		let mut producer = track.producer;
		let mut consumer = track.consumer;

		// Create groups out of order
		let mut g2 = producer.create_group(Group { sequence: 2 }).unwrap();
		g2.write_frame(&b"second"[..]).unwrap();
		g2.close().unwrap();

		let mut g0 = producer.create_group(Group { sequence: 0 }).unwrap();
		g0.write_frame(&b"first"[..]).unwrap();
		g0.close().unwrap();

		let mut g1 = producer.create_group(Group { sequence: 1 }).unwrap();
		g1.write_frame(&b"middle"[..]).unwrap();
		g1.close().unwrap();

		producer.close().unwrap();

		// Consumer should receive them in arrival order
		let mut group = consumer.next_group().await.unwrap().unwrap();
		assert_eq!(group.info.sequence, 2);

		group = consumer.next_group().await.unwrap().unwrap();
		assert_eq!(group.info.sequence, 0);

		group = consumer.next_group().await.unwrap().unwrap();
		assert_eq!(group.info.sequence, 1);
	}

	#[tokio::test]
	async fn test_track_close_flushes_pending() {
		let track = Track::new("test").produce();
		let mut producer = track.producer;
		let mut consumer = track.consumer;

		// Create a group and close the track without closing the group
		let mut group = producer.append_group().unwrap();
		group.write_frame(&b"pending"[..]).unwrap();
		// Note: not closing the group

		producer.close().unwrap();

		// Consumer should still be able to get the group
		let mut received_group = consumer.next_group().await.unwrap().unwrap();
		assert_eq!(received_group.info.sequence, 0);

		// And read the frame from it
		let frame = received_group.read_frame().await.unwrap().unwrap();
		assert_eq!(frame, Bytes::from_static(b"pending"));
	}

	#[tokio::test]
	async fn test_track_insert_group() {
		let track = Track::new("test").produce();
		let mut producer = track.producer;
		let mut consumer = track.consumer;

		// Create a group externally
		let external_group = Group { sequence: 10 }.produce();
		let mut external_producer = external_group.producer;
		external_producer.write_frame(&b"external"[..]).unwrap();
		external_producer.close().unwrap();

		// Insert it into the track
		producer.insert_group(external_producer).unwrap();
		producer.close().unwrap();

		// Consumer should receive it
		let mut group = consumer.next_group().await.unwrap().unwrap();
		assert_eq!(group.info.sequence, 10);
		let frame = group.read_frame().await.unwrap().unwrap();
		assert_eq!(frame, Bytes::from_static(b"external"));
	}

	#[tokio::test]
	async fn test_track_proxy() {
		let source = Track::new("source").produce();
		let mut source_producer = source.producer;
		let source_consumer = source.consumer;

		let dest = Track::new("dest").produce();
		let dest_producer = dest.producer;
		let mut dest_consumer = dest.consumer;

		source_producer.write_frame(&b"frame1"[..]).unwrap();
		source_producer.write_frame(&b"frame2"[..]).unwrap();
		source_producer.close().unwrap();

		let proxy_task = tokio::spawn(dest_producer.proxy(source_consumer));

		let mut g1 = dest_consumer.next_group().await.unwrap().unwrap();
		let f1 = g1.read_frame().await.unwrap().unwrap();
		assert_eq!(f1, Bytes::from_static(b"frame1"));

		let mut g2 = dest_consumer.next_group().await.unwrap().unwrap();
		let f2 = g2.read_frame().await.unwrap().unwrap();
		assert_eq!(f2, Bytes::from_static(b"frame2"));

		let none = dest_consumer.next_group().await;
		assert!(none.unwrap().is_none());

		proxy_task.await.unwrap().unwrap();
	}

	#[tokio::test(start_paused = true)]
	async fn test_track_proxy_abort() {
		let mut source_info = Track::new("source");
		source_info.expires = Duration::from_secs(10); // Long expiration
		let source = source_info.produce();
		let mut source_producer = source.producer;
		let source_consumer = source.consumer;

		let mut dest_info = Track::new("dest");
		dest_info.expires = Duration::from_secs(10); // Long expiration
		let dest = dest_info.produce();
		let dest_producer = dest.producer;
		let dest_consumer = dest.consumer;

		source_producer.write_frame(&b"frame1"[..]).unwrap();
		source_producer.abort(Error::Expired);

		let proxy_task = tokio::spawn(dest_producer.proxy(source_consumer));

		let result = dest_consumer.closed().await;
		assert!(result.is_err());

		// The proxy task should return an error (propagated from source abort)
		let proxy_result = proxy_task.await.unwrap();
		assert!(proxy_result.is_err());
	}

	#[tokio::test]
	async fn test_track_expires_modifier() {
		let mut track_info = Track::new("test");
		track_info.expires = Duration::from_secs(100);
		let track = track_info.produce();
		let mut producer = track.producer;

		producer.write_frame(&b"frame1"[..]).unwrap();

		// Create a consumer with a shorter expiration
		let consumer = track.consumer.expires(Duration::from_millis(50));

		producer.write_frame(&b"frame2"[..]).unwrap();
		producer.close().unwrap();

		// The consumer should work normally
		assert!(consumer.closed().await.is_ok());
	}
}
