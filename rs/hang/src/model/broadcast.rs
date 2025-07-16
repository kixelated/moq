use crate::catalog::{Audio, Catalog, CatalogConsumer, CatalogProducer, Video};
use crate::model::{TrackConsumer, TrackProducer};
use moq_lite::Track;
use web_async::spawn;

/// A broadcast producer that automatically manages a catalog of available tracks.
///
/// This wraps a `moq_lite::BroadcastProducer` and automatically creates and maintains
/// a `catalog.json` track that describes all audio and video tracks in the broadcast.
/// Clients can subscribe to this catalog to discover available content.
///
/// ## Automatic Catalog Management
///
/// - When tracks are added, they're automatically included in the catalog.
/// - When tracks end, they're automatically removed from the catalog.
/// - The catalog is republished whenever it changes.
#[derive(Clone)]
pub struct BroadcastProducer {
	catalog: CatalogProducer,

	/// The underlying MoQ broadcast producer.
	pub inner: moq_lite::BroadcastProducer,
}

impl Default for BroadcastProducer {
	fn default() -> Self {
		Self::new()
	}
}

impl BroadcastProducer {
	/// Create a new broadcast producer with an empty catalog.
	pub fn new() -> Self {
		let catalog = Catalog::default().produce();
		let mut inner = moq_lite::BroadcastProducer::new();
		inner.insert(catalog.consume().track);

		Self { catalog, inner }
	}

	/// Create a consumer for this broadcast.
	pub fn consume(&self) -> BroadcastConsumer {
		BroadcastConsumer {
			catalog: self.catalog.consume(),
			inner: self.inner.consume(),
		}
	}

	/// Add an existing video track to the broadcast.
	///
	/// The track will be added to the catalog and the catalog will be republished.
	/// When the track ends, it will be automatically removed from the catalog.
	pub fn add_video(&mut self, track: TrackConsumer, info: Video) {
		self.inner.insert(track.inner.clone());
		self.catalog.add_video(info.clone());
		self.catalog.publish();

		let mut this = self.clone();
		spawn(async move {
			let _ = track.closed().await;
			this.catalog.remove_video(&info);
			this.catalog.publish();
		});
	}

	/// Add an existing audio track to the broadcast.
	///
	/// The track will be added to the catalog and the catalog will be republished.
	/// When the track ends, it will be automatically removed from the catalog.
	pub fn add_audio(&mut self, track: TrackConsumer, info: Audio) {
		self.inner.insert(track.inner.clone());
		self.catalog.add_audio(info.clone());
		self.catalog.publish();

		let mut this = self.clone();
		spawn(async move {
			let _ = track.closed().await;
			this.catalog.remove_audio(&info);
			this.catalog.publish();
		});
	}

	/// Create and add a new video track to the broadcast.
	///
	/// This is a convenience method that creates a new track producer,
	/// adds it to the broadcast, and returns the producer for writing frames.
	pub fn create_video(&mut self, video: Video) -> TrackProducer {
		let producer: TrackProducer = video.track.clone().produce().into();
		self.add_video(producer.consume(), video);
		producer
	}

	/// Create and add a new audio track to the broadcast.
	///
	/// This is a convenience method that creates a new track producer,
	/// adds it to the broadcast, and returns the producer for writing frames.
	pub fn create_audio(&mut self, audio: Audio) -> TrackProducer {
		let producer: TrackProducer = audio.track.clone().produce().into();
		self.add_audio(producer.consume(), audio);
		producer
	}

	/*
	// Given a producer, publish the location track and update the catalog accordingly.
	// If a handle is provided, then it can be used by peers to update our position.
	pub fn location(&mut self, producer: &LocationProducer, handle: Option<u32>) {
		self.inner.insert(producer.track.consume());

		self.catalog.set_location(Some(Location {
			handle,
			initial: producer.latest(),
			updates: Some(producer.track.info.clone()),
			peers: HashMap::new(),
		}));

		self.catalog.publish();
	}
	*/
}

impl std::ops::Deref for BroadcastProducer {
	type Target = moq_lite::BroadcastProducer;

	fn deref(&self) -> &Self::Target {
		&self.inner
	}
}

impl std::ops::DerefMut for BroadcastProducer {
	fn deref_mut(&mut self) -> &mut Self::Target {
		&mut self.inner
	}
}

/// A broadcast consumer, using a catalog to discover/fetch tracks.
///
/// This wraps a `moq_lite::BroadcastConsumer` and automatically subscribes to
/// the `catalog.json` track to discover available audio and video tracks.
#[derive(Clone)]
pub struct BroadcastConsumer {
	/// Access to the catalog consumer for discovering tracks and metadata.
	pub catalog: CatalogConsumer,

	/// The underlying MoQ broadcast consumer.
	pub inner: moq_lite::BroadcastConsumer,
}

impl BroadcastConsumer {
	/// Create a new broadcast consumer from a MoQ broadcast consumer.
	///
	/// This automatically subscribes to the `catalog.json` track.
	pub fn new(inner: moq_lite::BroadcastConsumer) -> Self {
		let catalog = Track {
			name: Catalog::DEFAULT_NAME.to_string(),
			priority: 100,
		};
		let catalog = inner.subscribe(&catalog).into();

		Self { catalog, inner }
	}

	/// Subscribe to a track, wrapping it in a hang `TrackConsumer`.
	///
	/// This provides hang-specific functionality like timestamp decoding
	/// and latency management.
	pub fn subscribe(&self, track: &Track) -> TrackConsumer {
		self.inner.subscribe(track).into()
	}
}

impl std::ops::Deref for BroadcastConsumer {
	type Target = moq_lite::BroadcastConsumer;

	fn deref(&self) -> &Self::Target {
		&self.inner
	}
}

impl std::ops::DerefMut for BroadcastConsumer {
	fn deref_mut(&mut self) -> &mut Self::Target {
		&mut self.inner
	}
}
