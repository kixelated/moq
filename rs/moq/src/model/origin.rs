use std::{
	collections::HashMap,
	sync::atomic::{AtomicU64, Ordering},
};
use tokio::sync::mpsc;
use web_async::Lock;

use super::BroadcastConsumer;
use crate::{AsPath, Path, PathOwned, Produce};

static NEXT_CONSUMER_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct ConsumerId(u64);

impl ConsumerId {
	fn new() -> Self {
		Self(NEXT_CONSUMER_ID.fetch_add(1, Ordering::Relaxed))
	}
}

// If there are multiple broadcasts with the same path, we use the most recent one but keep the others around.
struct OriginBroadcast {
	path: PathOwned,
	active: BroadcastConsumer,
	backup: Vec<BroadcastConsumer>,
}

#[derive(Default)]
struct OriginNode {
	// The broadcast that is published to this node.
	broadcast: Option<OriginBroadcast>,

	// Nested nodes, one level down the tree.
	nested: HashMap<String, Lock<OriginNode>>,

	// Consumers that are subscribed to this node.
	// We store a consumer ID so we can remove it easily when it closes.
	consumers: HashMap<ConsumerId, mpsc::UnboundedSender<OriginAnnounce>>,
}

impl OriginNode {
	fn leaf(&self, path: &Path) -> Option<Lock<OriginNode>> {
		let (dir, rest) = path.next_part()?;
		self.nested.get(dir)?.lock().leaf(&rest)
	}

	// Returns true if we need to reannounce the path to all consumers.
	fn publish(&mut self, path: impl AsPath, broadcast: &BroadcastConsumer, rest: impl AsPath) -> bool {
		let path = path.as_path();
		let rest = rest.as_path();

		// If the path has a directory component, then publish it to the nested node.
		let reannounce = if let Some((dir, rest)) = rest.next_part() {
			// Not using entry to avoid allocating a string most of the time.
			self.nested
				.entry(dir.to_string())
				.or_default()
				.lock()
				.publish(&path, broadcast, &rest)
		} else if let Some(existing) = &mut self.broadcast {
			// This node is a leaf with an existing broadcast.
			let old = existing.active.clone();
			existing.active = broadcast.clone();
			existing.backup.push(old);
			true
		} else {
			// This node is a leaf with no existing broadcast.
			self.broadcast = Some(OriginBroadcast {
				path: path.to_owned(),
				active: broadcast.clone(),
				backup: Vec::new(),
			});
			false
		};

		for tx in self.consumers.values() {
			if reannounce {
				tx.send((path.to_owned(), None)).expect("consumer closed");
			}

			tx.send((path.to_owned(), Some(broadcast.clone())))
				.expect("consumer closed");
		}

		reannounce
	}

	fn consume(&mut self, id: ConsumerId, mut tx: mpsc::UnboundedSender<OriginAnnounce>) {
		self.consumers.insert(id, tx.clone());
		self.consume_initial(&mut tx);
	}

	fn consume_initial(&mut self, tx: &mut mpsc::UnboundedSender<OriginAnnounce>) {
		if let Some(broadcast) = &self.broadcast {
			tx.send((broadcast.path.clone(), Some(broadcast.active.clone())))
				.unwrap();
		}

		// Recursively subscribe to all nested nodes.
		for (_, nested) in &self.nested {
			nested.lock().consume_initial(tx);
		}
	}

	fn consume_broadcast(&self, rest: impl AsPath) -> Option<BroadcastConsumer> {
		let rest = rest.as_path();

		if let Some((dir, rest)) = rest.next_part() {
			let node = self.nested.get(dir)?.lock();
			node.consume_broadcast(&rest)
		} else {
			self.broadcast.as_ref().map(|b| b.active.clone())
		}
	}

	fn unconsume(&mut self, id: ConsumerId) {
		self.consumers.remove(&id).expect("consumer not found");
		if self.is_empty() {
			tracing::warn!("TODO: empty node; memory leak");
		}
	}

	fn remove(&mut self, path: impl AsPath, broadcast: BroadcastConsumer, rest: impl AsPath) {
		let path = path.as_path();
		let rest = rest.as_path();

		if let Some((dir, rest)) = rest.next_part() {
			let mut nested = self.nested.entry(dir.to_string()).or_default().lock();
			nested.remove(path, broadcast, &rest);
			if nested.is_empty() {
				drop(nested);
				self.nested.remove(dir);
			}
			return;
		}

		let entry = match &mut self.broadcast {
			Some(existing) => existing,
			None => return,
		};

		// See if we can remove the broadcast from the backup list.
		let pos = entry.backup.iter().position(|b| b.is_clone(&broadcast));
		if let Some(pos) = pos {
			entry.backup.remove(pos);
			// Nothing else to do
			return;
		}

		// Okay so it must be the active broadcast or else we fucked up.
		assert!(entry.active.is_clone(&broadcast));

		for consumer in self.consumers.values() {
			consumer.send((path.to_owned(), None)).expect("consumer closed");
		}

		// If there's a backup broadcast, then announce it.
		if let Some(active) = entry.backup.pop() {
			entry.active = active;

			for consumer in self.consumers.values() {
				consumer
					.send((path.to_owned(), Some(entry.active.clone())))
					.expect("consumer closed");
			}

			return;
		}

		// No more backups, so remove the entry.
		self.broadcast = None;
	}

	fn is_empty(&self) -> bool {
		self.broadcast.is_none() && self.nested.is_empty() && self.consumers.is_empty()
	}
}

#[derive(Clone)]
struct OriginRoots {
	roots: Vec<(PathOwned, Lock<OriginNode>)>,
}

impl OriginRoots {
	// Returns nested roots that match the prefixes.
	// TODO enforce that prefixes can't overlap.
	pub fn scope(&self, prefixes: &[Path]) -> Option<Self> {
		let mut roots = Vec::new();

		for (root, state) in &self.roots {
			for prefix in prefixes {
				if !prefix.has_prefix(root) {
					continue;
				}

				let nested = match state.lock().leaf(prefix) {
					Some(nested) => nested,
					None => state.clone(),
				};

				roots.push((root.clone(), nested));
			}
		}

		if roots.is_empty() {
			None
		} else {
			Some(Self { roots })
		}
	}

	// Returns the root that has this prefix.
	pub fn get(&self, path: impl AsPath) -> Option<Lock<OriginNode>> {
		let path = path.as_path();

		for (root, state) in &self.roots {
			if !path.has_prefix(root) {
				continue;
			}

			return Some(state.clone());
		}

		None
	}
}

impl Default for OriginRoots {
	fn default() -> Self {
		Self {
			roots: vec![("".into(), Default::default())],
		}
	}
}

/// A broadcast path and its associated consumer, or None if closed.
pub type OriginAnnounce = (Path<'static>, Option<BroadcastConsumer>);

pub struct Origin {}

impl Origin {
	pub fn produce() -> Produce<OriginProducer, OriginConsumer> {
		let producer = OriginProducer::default();
		let consumer = producer.consume();
		Produce { producer, consumer }
	}
}

/// Announces broadcasts to consumers over the network.
#[derive(Clone, Default)]
pub struct OriginProducer {
	// The roots of the tree that we are allowed to publish.
	// A path of "" means we can publish anything.
	roots: OriginRoots,

	/// The prefix that is automatically stripped from all paths.
	prefix: PathOwned,
}

impl OriginProducer {
	/// Publish a broadcast, announcing it to all consumers.
	///
	/// The broadcast will be unannounced when it is closed.
	/// If there is already a broadcast with the same path, then it will be replaced and reannounced.
	/// If the old broadcast is closed before the new one, then nothing will happen.
	/// If the new broadcast is closed before the old one, then the old broadcast will be reannounced.
	///
	/// Returns false if the broadcast is not allowed to be published.
	pub fn publish_broadcast(&mut self, path: impl AsPath, broadcast: BroadcastConsumer) -> bool {
		let path = path.as_path();

		let root = match self.roots.get(&path) {
			Some(root) => root,
			None => return false,
		};

		root.lock().publish(&path, &broadcast, &path);
		let root = root.clone();
		let path = path.to_owned();

		web_async::spawn(async move {
			broadcast.closed().await;
			root.lock().remove(&path, broadcast, &path);
		});

		true
	}

	/// Returns a new OriginProducer where all published broadcasts MUST match one of the prefixes.
	///
	/// Returns None if there are no legal prefixes.
	pub fn publish_only(&self, prefixes: &[Path]) -> Option<OriginProducer> {
		Some(OriginProducer {
			roots: self.roots.scope(prefixes)?,
			prefix: self.prefix.clone(),
		})
	}

	/// Subscribe to all announced broadcasts.
	pub fn consume(&self) -> OriginConsumer {
		OriginConsumer::new(self.roots.clone(), self.prefix.clone())
	}

	/// Subscribe to all announced broadcasts matching the prefix.
	///
	/// TODO: Don't use overlapping prefixes or duplicates will be published.
	///
	/// Returns None if there are no legal prefixes.
	pub fn consume_only(&self, prefixes: &[Path]) -> Option<OriginConsumer> {
		Some(OriginConsumer::new(self.roots.scope(prefixes)?, self.prefix.clone()))
	}

	/// Returns a new OriginProducer that automatically strips out the provided prefix.
	///
	/// Returns None if the provided root is not authorized; when publish_only was already used without a wildcard.
	pub fn with_root(&self, prefix: impl AsPath) -> Option<Self> {
		let prefix = prefix.as_path();

		Some(Self {
			prefix: self.prefix.join(&prefix).to_owned(),
			roots: self.roots.scope(&[prefix])?,
		})
	}

	/// Returns the prefix that is automatically stripped from all paths.
	pub fn prefix(&self) -> &Path {
		&self.prefix
	}
}

/// Consumes announced broadcasts matching against an optional prefix.
pub struct OriginConsumer {
	id: ConsumerId,
	roots: OriginRoots,
	updates: mpsc::UnboundedReceiver<OriginAnnounce>,

	/// A prefix that is automatically stripped from all paths.
	prefix: PathOwned,
}

impl OriginConsumer {
	fn new(roots: OriginRoots, prefix: PathOwned) -> Self {
		let (tx, rx) = mpsc::unbounded_channel();

		let id = ConsumerId::new();
		for (_, state) in &roots.roots {
			state.lock().consume(id, tx.clone());
		}

		Self {
			id,
			roots,
			updates: rx,
			prefix,
		}
	}

	/// Returns the next (un)announced broadcast and the absolute path.
	///
	/// The broadcast will only be announced if it was previously unannounced.
	/// The same path won't be announced/unannounced twice, instead it will toggle.
	/// Returns None if the consumer is closed.
	///
	/// Note: The returned path is absolute and will always match this consumer's prefix.
	pub async fn announced(&mut self) -> Option<OriginAnnounce> {
		self.updates.recv().await
	}

	/// Returns the next (un)announced broadcast and the absolute path without blocking.
	///
	/// Returns None if there is no update available; NOT because the consumer is closed.
	/// You have to use `is_closed` to check if the consumer is closed.
	pub fn try_announced(&mut self) -> Option<OriginAnnounce> {
		self.updates.try_recv().ok()
	}

	/// Get a specific broadcast by path.
	///
	/// TODO This should include announcement support.
	///
	/// Returns None if the path hasn't been announced yet.
	pub fn consume_broadcast<'a>(&self, path: impl AsPath) -> Option<BroadcastConsumer> {
		let path = path.as_path();
		let root = self.roots.get(&path)?;
		let state = root.lock();
		state.consume_broadcast(path)
	}

	/// Returns a new OriginConsumer that only consumes broadcasts matching one of the prefixes.
	///
	/// Returns None if there are no legal prefixes (would always return None).
	pub fn consume_only(&self, prefixes: &[Path]) -> Option<OriginConsumer> {
		Some(OriginConsumer::new(self.roots.scope(prefixes)?, self.prefix.clone()))
	}

	/// Returns the prefix that is automatically stripped from all paths.
	pub fn prefix(&self) -> &Path {
		&self.prefix
	}
}

impl Clone for OriginConsumer {
	fn clone(&self) -> Self {
		Self::new(self.roots.clone(), self.prefix.clone())
	}
}

impl Drop for OriginConsumer {
	fn drop(&mut self) {
		for (_, root) in &self.roots.roots {
			root.lock().unconsume(self.id);
		}
	}
}

#[cfg(test)]
use futures::FutureExt;

#[cfg(test)]
impl OriginConsumer {
	pub fn assert_next(&mut self, expected: impl AsPath, broadcast: &BroadcastConsumer) {
		let expected = expected.as_path();
		let (path, active) = self.announced().now_or_never().expect("next blocked").expect("no next");
		assert_eq!(path, expected, "wrong path");
		assert!(active.unwrap().is_clone(broadcast), "should be the same broadcast");
	}

	pub fn assert_try_next(&mut self, expected: impl AsPath, broadcast: &BroadcastConsumer) {
		let expected = expected.as_path();
		let (path, active) = self.try_announced().expect("no next");
		assert_eq!(path, expected, "wrong path");
		assert!(active.unwrap().is_clone(broadcast), "should be the same broadcast");
	}

	pub fn assert_next_none(&mut self, expected: impl AsPath) {
		let expected = expected.as_path();
		let (path, active) = self.announced().now_or_never().expect("next blocked").expect("no next");
		assert_eq!(path, expected, "wrong path");
		assert!(active.is_none(), "should be unannounced");
	}

	pub fn assert_next_wait(&mut self) {
		assert!(self.announced().now_or_never().is_none(), "next should block");
	}

	pub fn assert_next_closed(&mut self) {
		assert!(
			self.announced().now_or_never().expect("next blocked").is_none(),
			"next should be closed"
		);
	}
}

#[cfg(test)]
mod tests {
	use crate::Broadcast;

	use super::*;

	#[tokio::test]
	async fn test_announce() {
		let mut origin = Origin::produce();
		let broadcast1 = Broadcast::produce();
		let broadcast2 = Broadcast::produce();

		let mut consumer1 = origin.consumer;
		// Make a new consumer that should get it.
		consumer1.assert_next_wait();

		// Publish the first broadcast.
		origin.producer.publish_broadcast("test1", broadcast1.consumer);

		consumer1.assert_next("test1", &broadcast1.producer.consume());
		consumer1.assert_next_wait();

		// Make a new consumer that should get the existing broadcast.
		// But we don't consume it yet.
		let mut consumer2 = origin.producer.consume();

		// Publish the second broadcast.
		origin.producer.publish_broadcast("test2", broadcast2.consumer);

		consumer1.assert_next("test2", &broadcast2.producer.consume());
		consumer1.assert_next_wait();

		consumer2.assert_next("test1", &broadcast1.producer.consume());
		consumer2.assert_next("test2", &broadcast2.producer.consume());
		consumer2.assert_next_wait();

		// Close the first broadcast.
		drop(broadcast1.producer);

		// Wait for the async task to run.
		tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;

		// All consumers should get a None now.
		consumer1.assert_next_none("test1");
		consumer2.assert_next_none("test1");
		consumer1.assert_next_wait();
		consumer2.assert_next_wait();

		// And a new consumer only gets the last broadcast.
		let mut consumer3 = origin.producer.consume();
		consumer3.assert_next("test2", &broadcast2.producer.consume());
		consumer3.assert_next_wait();

		// Close the producer and make sure it cleans up
		drop(origin.producer);

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
		let mut origin = Origin::produce();
		let broadcast1 = Broadcast::produce();
		let broadcast2 = Broadcast::produce();

		origin.producer.publish_broadcast("test", broadcast1.consumer);
		origin.producer.publish_broadcast("test", broadcast2.consumer);
		assert!(origin.consumer.consume_broadcast("test").is_some());
		origin.consumer.assert_next_none("test");

		drop(broadcast1.producer);

		// Wait for the async task to run.
		tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;
		assert!(origin.consumer.consume_broadcast("test").is_some());

		drop(broadcast2.producer);

		// Wait for the async task to run.
		tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;
		assert!(origin.consumer.consume_broadcast("test").is_none());
	}

	#[tokio::test]
	async fn test_duplicate_reverse() {
		let mut origin = Origin::produce();
		let broadcast1 = Broadcast::produce();
		let broadcast2 = Broadcast::produce();

		origin.producer.publish_broadcast("test", broadcast1.consumer);
		origin.producer.publish_broadcast("test", broadcast2.consumer);
		assert!(origin.consumer.consume_broadcast("test").is_some());

		// This is harder, dropping the new broadcast first.
		drop(broadcast2.producer);

		// Wait for the cleanup async task to run.
		tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;
		assert!(origin.consumer.consume_broadcast("test").is_some());

		drop(broadcast1.producer);

		// Wait for the cleanup async task to run.
		tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;
		assert!(origin.consumer.consume_broadcast("test").is_none());
	}

	#[tokio::test]
	async fn test_double_publish() {
		let mut origin = Origin::produce();
		let broadcast = Broadcast::produce();

		// Ensure it doesn't crash.
		origin.producer.publish_broadcast("test", broadcast.producer.consume());
		origin.producer.publish_broadcast("test", broadcast.producer.consume());

		assert!(origin.consumer.consume_broadcast("test").is_some());

		drop(broadcast.producer);

		// Wait for the async task to run.
		tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;
		assert!(origin.consumer.consume_broadcast("test").is_none());
	}
	// There was a tokio bug where only the first 127 broadcasts would be received instantly.
	#[tokio::test]
	#[should_panic]
	async fn test_128() {
		let mut origin = Origin::produce();
		let broadcast = Broadcast::produce();

		for i in 0..256 {
			origin
				.producer
				.publish_broadcast(format!("test{i}"), broadcast.consumer.clone());
		}

		for i in 0..256 {
			origin.consumer.assert_next(format!("test{i}"), &broadcast.consumer);
		}
	}

	#[tokio::test]
	async fn test_128_fix() {
		let mut origin = Origin::produce();
		let broadcast = Broadcast::produce();

		for i in 0..256 {
			origin
				.producer
				.publish_broadcast(format!("test{i}"), broadcast.consumer.clone());
		}

		for i in 0..256 {
			// try_next does not have the same issue because it's synchronous.
			origin.consumer.assert_try_next(format!("test{i}"), &broadcast.consumer);
		}
	}
}
