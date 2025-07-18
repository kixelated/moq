use std::collections::{hash_map, HashMap};
use tokio::sync::mpsc;
use web_async::{Lock, LockWeak};

use super::BroadcastConsumer;
use crate::{Path, PathRef};

// If there are multiple broadcasts with the same path, we use the most recent one but keep the others around.
struct BroadcastState {
	active: BroadcastConsumer,
	backup: Vec<BroadcastConsumer>,
}

#[derive(Default)]
struct ProducerState {
	active: HashMap<Path, BroadcastState>,
	consumers: Vec<ConsumerState>,
}

impl ProducerState {
	// Returns true if this was a unique broadcast.
	fn publish(&mut self, path: Path, broadcast: BroadcastConsumer) -> bool {
		let mut unique = true;

		match self.active.entry(path.clone()) {
			hash_map::Entry::Occupied(mut entry) => {
				let state = entry.get_mut();
				if state.active.is_clone(&broadcast) {
					// If we're already publishing this broadcast, then don't do anything.
					return false;
				}

				// Make the new broadcast the active one.
				let old = state.active.clone();
				state.active = broadcast.clone();

				// Move the old broadcast to the backup list.
				// But we need to replace any previous duplicates.
				let pos = state.backup.iter().position(|b| b.is_clone(&broadcast));
				if let Some(pos) = pos {
					state.backup[pos] = old;

					// We're already publishing this broadcast, so don't run the cleanup task.
					unique = false;
				} else {
					state.backup.push(old);
				}

				// Reannounce the path to all consumers.
				retain_mut_unordered(&mut self.consumers, |c| c.remove(&path));
			}
			hash_map::Entry::Vacant(entry) => {
				entry.insert(BroadcastState {
					active: broadcast.clone(),
					backup: Vec::new(),
				});
			}
		};

		retain_mut_unordered(&mut self.consumers, |c| c.insert(&path, &broadcast));

		unique
	}

	fn remove(&mut self, path: Path, broadcast: BroadcastConsumer) {
		let mut entry = match self.active.entry(path.clone()) {
			hash_map::Entry::Occupied(entry) => entry,
			hash_map::Entry::Vacant(_) => panic!("broadcast not found"),
		};

		// See if we can remove the broadcast from the backup list.
		let pos = entry.get().backup.iter().position(|b| b.is_clone(&broadcast));
		if let Some(pos) = pos {
			entry.get_mut().backup.remove(pos);
			// Nothing else to do
			return;
		}

		// Okay so it must be the active broadcast or else we fucked up.
		assert!(entry.get().active.is_clone(&broadcast));

		retain_mut_unordered(&mut self.consumers, |c| c.remove(&path));

		// If there's a backup broadcast, then announce it.
		if let Some(active) = entry.get_mut().backup.pop() {
			entry.get_mut().active = active;
			retain_mut_unordered(&mut self.consumers, |c| c.insert(&path, &entry.get().active));
		} else {
			// No more backups, so remove the entry.
			entry.remove();
		}
	}
}

impl Drop for ProducerState {
	fn drop(&mut self) {
		for (path, _) in self.active.drain() {
			retain_mut_unordered(&mut self.consumers, |c| c.remove(&path));
		}
	}
}

// A faster version of retain_mut that doesn't maintain the order.
fn retain_mut_unordered<T, F: Fn(&mut T) -> bool>(vec: &mut Vec<T>, f: F) {
	let mut i = 0;
	while let Some(item) = vec.get_mut(i) {
		if f(item) {
			i += 1;
		} else {
			vec.swap_remove(i);
		}
	}
}

/// A broadcast path and its associated consumer, or None if closed.
/// The returned path is relative to the consumer's prefix.
pub struct OriginUpdate {
	pub suffix: Path,
	pub active: Option<BroadcastConsumer>,
}

struct ConsumerState {
	prefix: Path,
	updates: mpsc::UnboundedSender<OriginUpdate>,
}

impl ConsumerState {
	// Returns true if the consumer is still alive.
	pub fn insert<'a>(&mut self, path: impl Into<PathRef<'a>>, consumer: &BroadcastConsumer) -> bool {
		let path_ref = path.into();

		if let Some(suffix) = path_ref.to_path().strip_prefix(&self.prefix) {
			// Send the absolute path, not the relative suffix
			let update = OriginUpdate {
				suffix: suffix.into(),
				active: Some(consumer.clone()),
			};
			return self.updates.send(update).is_ok();
		}

		!self.updates.is_closed()
	}

	pub fn remove<'a>(&mut self, path: impl Into<PathRef<'a>>) -> bool {
		let path_ref = path.into();

		if let Some(suffix) = path_ref.to_path().strip_prefix(&self.prefix) {
			// Send the absolute path, not the relative suffix
			let update = OriginUpdate {
				suffix: suffix.into(),
				active: None,
			};
			return self.updates.send(update).is_ok();
		}

		!self.updates.is_closed()
	}
}

/// Announces broadcasts to consumers over the network.
#[derive(Clone, Default)]
pub struct OriginProducer {
	prefix: Path,
	state: Lock<ProducerState>,
}

impl OriginProducer {
	/// Create a new origin producer with an optional prefix applied to all broadcasts.
	pub fn new<T: Into<Path>>(prefix: T) -> Self {
		let prefix = prefix.into();
		Self {
			state: Lock::new(ProducerState {
				active: HashMap::new(),
				consumers: Vec::new(),
			}),
			prefix,
		}
	}

	/// Publish a broadcast, announcing it to all consumers.
	///
	/// The broadcast will be unannounced when it is closed.
	/// If there is already a broadcast with the same path, then it will be replaced and reannounced.
	/// If the old broadcast is closed before the new one, then nothing will happen.
	/// If the new broadcast is closed before the old one, then the old broadcast will be reannounced.
	pub fn publish<'a>(&mut self, suffix: impl Into<PathRef<'a>>, broadcast: BroadcastConsumer) {
		let path = self.prefix.join(suffix.into());

		if !self.state.lock().publish(path.clone(), broadcast.clone()) {
			// This is not a big deal, but we want to avoid spawning additional cleanup tasks.
			tracing::warn!(?path, "duplicate publish");
			return;
		}

		let state = self.state.clone().downgrade();

		// TODO cancel this task when the producer is dropped.
		web_async::spawn(async move {
			broadcast.closed().await;
			if let Some(state) = state.upgrade() {
				state.lock().remove(path, broadcast);
			}
		});
	}

	/// Create a new origin producer for the given sub-prefix.
	pub fn publish_prefix<'a>(&mut self, prefix: impl Into<PathRef<'a>>) -> OriginProducer {
		OriginProducer {
			prefix: self.prefix.join(prefix.into()),
			state: self.state.clone(),
		}
	}

	/// Get a specific broadcast by path.
	///
	/// The most recent, non-closed broadcast will be returned if there are duplicates.
	pub fn consume<'a>(&self, suffix: impl Into<PathRef<'a>>) -> Option<BroadcastConsumer> {
		let path = self.prefix.join(suffix.into());
		self.state.lock().active.get(&path).map(|b| b.active.clone())
	}

	/// Subscribe to all announced broadcasts.
	pub fn consume_all(&self) -> OriginConsumer {
		self.consume_prefix("")
	}

	/// Subscribe to all announced broadcasts matching the prefix.
	///
	/// NOTE: This takes a Suffix because it's appended to the existing prefix to get a new prefix.
	/// Confusing I know, but it means that we don't have to return a Result.
	pub fn consume_prefix<'a>(&self, prefix: impl Into<PathRef<'a>>) -> OriginConsumer {
		// Combine the consumer's prefix with the publisher's prefix.
		let prefix = self.prefix.join(prefix.into());

		let mut state = self.state.lock();

		let (tx, rx) = mpsc::unbounded_channel();
		let mut consumer = ConsumerState {
			prefix: prefix.clone(),
			updates: tx,
		};

		for (path, broadcast) in &state.active {
			consumer.insert(path, &broadcast.active);
		}
		state.consumers.push(consumer);

		OriginConsumer {
			prefix,
			updates: rx,
			producer: self.state.clone().downgrade(),
		}
	}

	/// Wait until all consumers have been dropped.
	///
	/// NOTE: subscribe can be called to unclose the producer.
	pub async fn unused(&self) {
		// Keep looping until all consumers are closed.
		while let Some(notify) = self.unused_inner() {
			notify.closed().await;
		}
	}

	// Returns the closed notify of any consumer.
	fn unused_inner(&self) -> Option<mpsc::UnboundedSender<OriginUpdate>> {
		let mut state = self.state.lock();

		while let Some(consumer) = state.consumers.last() {
			if !consumer.updates.is_closed() {
				return Some(consumer.updates.clone());
			}

			state.consumers.pop();
		}

		None
	}

	pub fn prefix(&self) -> &Path {
		&self.prefix
	}
}

/// Consumes announced broadcasts matching against an optional prefix.
pub struct OriginConsumer {
	// We need a weak reference to the producer so that we can clone it.
	producer: LockWeak<ProducerState>,
	updates: mpsc::UnboundedReceiver<OriginUpdate>,
	prefix: Path,
}

impl OriginConsumer {
	/// Returns the next (un)announced broadcast and the absolute path.
	///
	/// The broadcast will only be None if it was previously Some.
	/// The same path won't be announced/unannounced twice, instead it will toggle.
	///
	/// Note: The returned path is absolute and will always match this consumer's prefix.
	pub async fn next(&mut self) -> Option<OriginUpdate> {
		self.updates.recv().await
	}

	/// Get a specific broadcast by path.
	///
	/// This is relative to the consumer's prefix.
	pub fn consume<'a>(&self, suffix: impl Into<PathRef<'a>>) -> Option<BroadcastConsumer> {
		let path = self.prefix.join(suffix.into());

		let state = self.producer.upgrade()?;
		let state = state.lock();
		state.active.get(&path).map(|b| b.active.clone())
	}

	pub fn consume_all(&self) -> OriginConsumer {
		self.consume_prefix("")
	}

	pub fn consume_prefix<'a>(&self, prefix: impl Into<PathRef<'a>>) -> OriginConsumer {
		// Combine the consumer's prefix with the existing consumer's prefix.
		let prefix = self.prefix.join(prefix.into());

		let (tx, rx) = mpsc::unbounded_channel();

		// NOTE: consumer is immediately dropped, signalling FIN, if the producer can't be upgraded.
		let mut consumer = ConsumerState {
			prefix: prefix.clone(),
			updates: tx,
		};

		if let Some(state) = self.producer.upgrade() {
			let mut state = state.lock();

			for (path, broadcast) in &state.active {
				consumer.insert(path, &broadcast.active);
			}

			state.consumers.push(consumer);
		}

		OriginConsumer {
			prefix,
			updates: rx,
			producer: self.producer.clone(),
		}
	}

	pub fn prefix(&self) -> &Path {
		&self.prefix
	}
}

impl Clone for OriginConsumer {
	fn clone(&self) -> Self {
		self.consume_all()
	}
}

#[cfg(test)]
use futures::FutureExt;

#[cfg(test)]
impl OriginConsumer {
	pub fn assert_next(&mut self, path: &str, broadcast: &BroadcastConsumer) {
		let next = self.next().now_or_never().expect("next blocked").expect("no next");
		assert_eq!(next.suffix.as_str(), path, "wrong path");
		assert!(next.active.unwrap().is_clone(broadcast), "should be the same broadcast");
	}

	pub fn assert_next_none(&mut self, path: &str) {
		let next = self.next().now_or_never().expect("next blocked").expect("no next");
		assert_eq!(next.suffix.as_str(), path, "wrong path");
		assert!(next.active.is_none(), "should be unannounced");
	}

	pub fn assert_next_wait(&mut self) {
		assert!(self.next().now_or_never().is_none(), "next should block");
	}

	pub fn assert_next_closed(&mut self) {
		assert!(
			self.next().now_or_never().expect("next blocked").is_none(),
			"next should be closed"
		);
	}
}

#[cfg(test)]
mod tests {
	use crate::BroadcastProducer;

	use super::*;

	#[tokio::test]
	async fn test_announce() {
		let mut producer = OriginProducer::default();
		let broadcast1 = BroadcastProducer::new();
		let broadcast2 = BroadcastProducer::new();

		// Make a new consumer that should get it.
		let mut consumer1 = producer.consume_all();
		consumer1.assert_next_wait();

		// Publish the first broadcast.
		producer.publish("test1", broadcast1.consume());

		consumer1.assert_next("test1", &broadcast1.consume());
		consumer1.assert_next_wait();

		// Make a new consumer that should get the existing broadcast.
		// But we don't consume it yet.
		let mut consumer2 = producer.consume_all();

		// Publish the second broadcast.
		producer.publish("test2", broadcast2.consume());

		consumer1.assert_next("test2", &broadcast2.consume());
		consumer1.assert_next_wait();

		consumer2.assert_next("test1", &broadcast1.consume());
		consumer2.assert_next("test2", &broadcast2.consume());
		consumer2.assert_next_wait();

		// Close the first broadcast.
		drop(broadcast1);

		// Wait for the async task to run.
		tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;

		// All consumers should get a None now.
		consumer1.assert_next_none("test1");
		consumer2.assert_next_none("test1");
		consumer1.assert_next_wait();
		consumer2.assert_next_wait();

		// And a new consumer only gets the last broadcast.
		let mut consumer3 = producer.consume_all();
		consumer3.assert_next("test2", &broadcast2.consume());
		consumer3.assert_next_wait();

		// Close the producer and make sure it cleans up
		drop(producer);

		// Wait for the async task to run.
		tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;

		consumer1.assert_next_none("test2");
		consumer2.assert_next_none("test2");
		consumer3.assert_next_none("test2");

		consumer1.assert_next_closed();
		consumer2.assert_next_closed();
		consumer3.assert_next_closed();
	}

	#[tokio::test]
	async fn test_duplicate() {
		let mut producer = OriginProducer::default();
		let broadcast1 = BroadcastProducer::new();
		let broadcast2 = BroadcastProducer::new();

		producer.publish("test", broadcast1.consume());
		producer.publish("test", broadcast2.consume());
		assert!(producer.consume("test").is_some());

		drop(broadcast1);

		// Wait for the async task to run.
		tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;
		assert!(producer.consume("test").is_some());

		drop(broadcast2);

		// Wait for the async task to run.
		tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;
		assert!(producer.consume("test").is_none());
	}

	#[tokio::test]
	async fn test_duplicate_reverse() {
		let mut producer = OriginProducer::default();
		let broadcast1 = BroadcastProducer::new();
		let broadcast2 = BroadcastProducer::new();

		producer.publish("test", broadcast1.consume());
		producer.publish("test", broadcast2.consume());
		assert!(producer.consume("test").is_some());

		// This is harder, dropping the new broadcast first.
		drop(broadcast2);

		// Wait for the cleanup async task to run.
		tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;
		assert!(producer.consume("test").is_some());

		drop(broadcast1);

		// Wait for the cleanup async task to run.
		tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;
		assert!(producer.consume("test").is_none());
	}

	#[tokio::test]
	async fn test_double_publish() {
		let mut producer = OriginProducer::default();
		let broadcast = BroadcastProducer::new();

		// Ensure it doesn't crash.
		producer.publish("test", broadcast.consume());
		producer.publish("test", broadcast.consume());

		assert!(producer.consume("test").is_some());

		drop(broadcast);

		// Wait for the async task to run.
		tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;
		assert!(producer.consume("test").is_none());
	}
}
