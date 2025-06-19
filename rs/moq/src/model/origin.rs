use std::collections::{HashMap, VecDeque};
use tokio::sync::mpsc;
use web_async::Lock;

use super::BroadcastConsumer;

#[derive(Default)]
struct ProducerState {
	// If there are multiple broadcasts with the same path, then the Vec is ordered by least to most recent.
	active: HashMap<String, Vec<BroadcastConsumer>>,
	consumers: Vec<(Lock<ConsumerState>, mpsc::Sender<()>)>,
}

impl ProducerState {
	fn publish(&mut self, path: String, broadcast: BroadcastConsumer) {
		let entry = self.active.entry(path.clone()).or_default();

		// If this is a duplicate, then we need to bump it to the end of the list.
		if let Some(pos) = entry.iter().position(|b| b.is_clone(&broadcast)) {
			// If it's already the most recent broadcast, then we can just return.
			if pos == entry.len() - 1 {
				return;
			}

			// If it already exists, then remove it so we can add it to the end.
			entry.remove(pos);
		}

		// If there's a previous broadcast, then we need to reannounce it.
		if !entry.is_empty() {
			unannounce(&mut self.consumers, &path);
		}

		// Add the broadcast to the list and tell all consumers.
		entry.push(broadcast.clone());
		announce(&mut self.consumers, &path, broadcast);
	}

	fn remove(&mut self, path: &str, broadcast: BroadcastConsumer) {
		let mut entry = self.active.remove(path).unwrap();
		assert!(!entry.is_empty());

		if entry.len() == 1 {
			unannounce(&mut self.consumers, path);
			return;
		}

		// Figure out if this was the most recently announced broadcast.
		let pos = entry.iter().position(|b| b.is_clone(&broadcast)).unwrap();

		// If this was the most recent broadcast, then we will reannounce.
		if pos == entry.len() - 1 {
			unannounce(&mut self.consumers, path);
			entry.pop();
			announce(&mut self.consumers, path, entry.last().unwrap().clone());
		} else {
			// Otherwise, just remove the broadcast.
			entry.remove(pos);
		}

		// Add the remaining broadcasts back to the map.
		assert!(!entry.is_empty());
		self.active.insert(path.to_string(), entry);
	}

	fn consume<T: ToString>(&mut self, prefix: T) -> ConsumerState {
		let prefix = prefix.to_string();
		let mut updates = VecDeque::new();

		for (path, broadcast) in self.active.iter() {
			if let Some(suffix) = path.strip_prefix(&prefix) {
				updates.push_back((suffix.to_string(), broadcast.last().cloned()));
			}
		}

		ConsumerState { prefix, updates }
	}

	fn subscribe(&mut self, consumer: Lock<ConsumerState>) -> mpsc::Receiver<()> {
		let (tx, rx) = mpsc::channel(1);
		self.consumers.push((consumer.clone(), tx));
		rx
	}
}

impl Drop for ProducerState {
	fn drop(&mut self) {
		for (path, _) in self.active.drain() {
			unannounce(&mut self.consumers, &path);
		}
	}
}

// Separate functions to avoid the borrow checker.
fn announce(consumers: &mut Vec<(Lock<ConsumerState>, mpsc::Sender<()>)>, path: &str, broadcast: BroadcastConsumer) {
	let mut i = 0;

	// Notify all consumers of the new broadcast.
	while let Some((consumer, notify)) = consumers.get(i) {
		if !notify.is_closed() {
			if consumer.lock().insert(&path, &broadcast) {
				notify.try_send(()).ok();
			}
			i += 1;
		} else {
			consumers.swap_remove(i);
		}
	}
}

fn unannounce(consumers: &mut Vec<(Lock<ConsumerState>, mpsc::Sender<()>)>, path: &str) {
	let mut i = 0;

	// Reannounce to all consumers so they know the origin has changed.
	while let Some((consumer, notify)) = consumers.get(i) {
		if !notify.is_closed() {
			if consumer.lock().remove(&path) {
				notify.try_send(()).ok();
			}
			i += 1;
		} else {
			consumers.swap_remove(i);
		}
	}
}

#[derive(Clone)]
struct ConsumerState {
	prefix: String,
	updates: VecDeque<(String, Option<BroadcastConsumer>)>,
}

impl ConsumerState {
	pub fn insert(&mut self, path: &str, consumer: &BroadcastConsumer) -> bool {
		if let Some(suffix) = path.strip_prefix(&self.prefix) {
			self.updates.push_back((suffix.to_string(), Some(consumer.clone())));
			true
		} else {
			false
		}
	}

	pub fn remove(&mut self, path: &str) -> bool {
		if let Some(suffix) = path.strip_prefix(&self.prefix) {
			self.updates.push_back((suffix.to_string(), None));
			true
		} else {
			false
		}
	}
}

/// Announces broadcasts to consumers over the network.
#[derive(Default, Clone)]
pub struct OriginProducer {
	state: Lock<ProducerState>,
}

impl OriginProducer {
	pub fn new() -> Self {
		Self::default()
	}

	/// Publish a broadcast, announcing it to all consumers.
	///
	/// The broadcast will be unannounced when it is closed.
	/// If there is already a broadcast with the same path, then it will be replaced and reannounced.
	/// If the old broadcast is closed before the new one, then nothing will happen.
	/// If the new broadcast is closed before the old one, then the old broadcast will be reannounced.
	pub fn publish<S: ToString>(&mut self, path: S, broadcast: BroadcastConsumer) {
		let path = path.to_string();
		self.state.lock().publish(path.clone(), broadcast.clone());

		let state = self.state.clone().downgrade();

		// TODO cancel this task when the producer is dropped.
		web_async::spawn(async move {
			broadcast.closed().await;
			if let Some(state) = state.upgrade() {
				state.lock().remove(&path, broadcast);
			}
		});
	}

	/// Publish all broadcasts from the given origin.
	pub fn publish_all(&mut self, broadcasts: OriginConsumer) {
		self.publish_prefix("", broadcasts);
	}

	/// Publish all broadcasts from the given origin with an optional prefix.
	pub fn publish_prefix(&mut self, prefix: &str, mut broadcasts: OriginConsumer) {
		// Really gross that this just spawns a background task, but I want publishing to be sync.
		let mut this = self.clone();

		// Overkill to avoid allocating a string if the prefix is empty.
		let prefix = match prefix {
			"" => None,
			prefix => Some(prefix.to_string()),
		};

		web_async::spawn(async move {
			while let Some((suffix, Some(broadcast))) = broadcasts.next().await {
				let path = match &prefix {
					Some(prefix) => format!("{}{}", prefix, suffix),
					None => suffix,
				};

				this.publish(path, broadcast);
			}
		});
	}

	/// Get a specific broadcast by name.
	///
	/// The most recent, non-closed broadcast will be returned if there are duplicates.
	pub fn consume(&self, path: &str) -> Option<BroadcastConsumer> {
		self.state.lock().active.get(path).and_then(|b| b.last().cloned())
	}

	/// Subscribe to all announced broadcasts.
	pub fn consume_all(&self) -> OriginConsumer {
		self.consume_prefix("")
	}

	/// Subscribe to all announced broadcasts matching the prefix.
	pub fn consume_prefix<S: ToString>(&self, prefix: S) -> OriginConsumer {
		let mut state = self.state.lock();
		let consumer = Lock::new(state.consume(prefix));
		let notify = state.subscribe(consumer.clone());
		OriginConsumer::new(consumer, notify)
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
	fn unused_inner(&self) -> Option<mpsc::Sender<()>> {
		let mut state = self.state.lock();

		while let Some((_, notify)) = state.consumers.last() {
			if !notify.is_closed() {
				return Some(notify.clone());
			}

			state.consumers.pop();
		}

		None
	}
}

/// Consumes announced broadcasts matching against an optional prefix.
pub struct OriginConsumer {
	state: Lock<ConsumerState>,
	notify: mpsc::Receiver<()>,
}

impl OriginConsumer {
	fn new(state: Lock<ConsumerState>, notify: mpsc::Receiver<()>) -> Self {
		Self { state, notify }
	}

	/// Returns the next (un)announced broadcast and the path.
	///
	/// The broadcast will only be None if it was previously Some.
	/// The same path won't be announced/unannounced twice, instead it will toggle.
	pub async fn next(&mut self) -> Option<(String, Option<BroadcastConsumer>)> {
		loop {
			{
				let mut state = self.state.lock();

				if let Some(update) = state.updates.pop_front() {
					return Some(update);
				}
			}

			self.notify.recv().await?;
		}
	}
}

#[cfg(test)]
use futures::FutureExt;

#[cfg(test)]
impl OriginConsumer {
	pub fn assert_next(&mut self, path: &str, broadcast: &BroadcastConsumer) {
		let next = self.next().now_or_never().expect("next blocked").expect("no next");
		assert_eq!(next.0, path, "wrong path");
		assert!(next.1.unwrap().is_clone(broadcast), "should be the same broadcast");
	}

	pub fn assert_next_none(&mut self, path: &str) {
		let next = self.next().now_or_never().expect("next blocked").expect("no next");
		assert_eq!(next.0, path, "wrong path");
		assert!(next.1.is_none(), "should be unannounced");
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
		let mut producer = OriginProducer::new();
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
		let mut producer = OriginProducer::new();
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
		let mut producer = OriginProducer::new();
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
}
