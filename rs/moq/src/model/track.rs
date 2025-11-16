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
	groups: VecDeque<(GroupConsumer, std::time::Instant)>,
	// Store the max sequence number
	max: u64,
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
			self.max = group.info.sequence;
		}

		self.groups.push_back((group.consume(), std::time::Instant::now()));

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

		let sequence = self.max + 1;
		let group = Group { sequence }.produce();
		self.groups.push_back((group.consumer, std::time::Instant::now()));

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
					.wait_for(|state| state.closed.is_some() || state.max > sequence)
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
			expires: expires,
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
