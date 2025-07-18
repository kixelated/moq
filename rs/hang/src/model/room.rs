use std::collections::HashSet;

use web_async::Lock;

use crate::model::{BroadcastConsumer, BroadcastProducer};

pub struct Room {
	pub prefix: String,
	broadcasts: moq_lite::OriginConsumer,
	publisher: moq_lite::OriginProducer,
	publishing: Lock<HashSet<String>>,
}

impl Room {
	pub fn new(publisher: moq_lite::OriginProducer, subscriber: moq_lite::OriginConsumer, prefix: String) -> Self {
		Self {
			broadcasts: subscriber,
			publisher,
			prefix,
			publishing: Default::default(),
		}
	}

	/// Joins the room, publishing the broadcast.
	pub fn publish(&mut self, name: String, broadcast: BroadcastProducer) {
		self.publishing.lock().insert(name.clone());

		let path = format!("{}{}", self.prefix, name);
		self.publisher.publish(path, broadcast.inner.consume());

		let consumer = broadcast.inner.consume();
		let publishing = self.publishing.clone();

		// Remove the broadcast when it's closed
		web_async::spawn(async move {
			let _ = consumer.closed().await;
			publishing.lock().remove(&name);
		});
	}

	/// Returns the next broadcaster in the room (not including ourselves).
	///
	/// If None is returned, then the broadcaster with that name has stopped broadcasting or is being reannounced.
	/// When reannounced, the old BroadcastConsumer won't necessarily be closed, so you might have two broadcasts with the same name.
	pub async fn watch(&mut self) -> Option<(String, Option<BroadcastConsumer>)> {
		loop {
			let (absolute_path, broadcast) = self.broadcasts.next().await?;

			// Convert absolute path to relative path for comparison
			// This should always succeed since Subscriber filters by prefix
			let suffix = absolute_path
				.strip_prefix(&moq_lite::Path::from(&self.prefix))
				.expect("Subscriber should only return broadcasts matching its prefix");
			let relative_path = suffix.to_string();

			if self.publishing.lock().contains(&relative_path) {
				// We're publishing this broadcast, so skip it.
				continue;
			}

			return Some((relative_path, broadcast.map(BroadcastConsumer::new)));
		}
	}

	// Ugh
	/*
	async fn update_location(producer: CatalogProducer, mut peer: BroadcastConsumer) -> Result<()> {
		let mut consumer = producer.consume();
		let mut handle = None;

		let mut local_track: Option<LocationProducer> = None;

		// The last known location entry in the peer's catalog.
		let mut peer_location: Option<Location> = None;

		// The active track in the peer's catalog providing our location.
		let mut peer_track: Option<LocationConsumer> = None;

		loop {
			tokio::select! {
				catalog = consumer.next() => {
					// Grab the track/handle we're using, which we'll use to look for peers.
					let catalog = match catalog? {
						Some(catalog) => catalog,
						None => return Ok(()),
					};

					// Grab the handle we're using, which allows peers to publish their location.
					handle = catalog.location.as_ref().and_then(|location| location.handle);

					if let Some(track) = catalog.location.as_ref().and_then(|location| location.updates) {
					}
				},
				catalog = peer.catalog.next() => {
					peer_location = match catalog? {
						Some(catalog) => catalog.location,
						None => return Ok(()),
					};
				},
				position = async { peer_track.as_mut()?.next().await.transpose() } => {
					match position {
						Some(Ok(position)) => {
							let catalog = producer.update();
							catalog.location.as_mut().unwrap().position = position;
						}
						Some(Err(e)) => return Err(e),
						None => peer_track = None,
					}
				}
			}

			if let Some(handle) = handle {
				// Check the peer's catalog for the handle.
				let track = peer_location.as_ref().and_then(|location| location.peers.get(&handle));

				if let Some(track) = track {
					let track = peer.subscribe(track);
					peer_track = Some(LocationConsumer::new(track));
				}
			}
		}
	}
	*/
}
