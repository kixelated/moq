use std::sync::{Arc, Mutex, MutexGuard};

use crate::catalog;

use crate::error::Result;

/// Produces a catalog track that describes the available media tracks.
///
/// The JSON catalog is updated when tracks are added/removed but is *not* automatically published.
/// You'll have to call [`publish`](Self::publish) once all updates are complete.
#[derive(Clone)]
pub struct CatalogProducer {
	/// Access to the underlying track producer.
	pub track: moq_lite::TrackProducer,
	current: Arc<Mutex<catalog::Root>>,
}

impl CatalogProducer {
	/// Create a new catalog producer with the given track and initial catalog.
	pub fn new(track: moq_lite::TrackProducer, init: catalog::Root) -> Self {
		Self {
			current: Arc::new(Mutex::new(init)),
			track,
		}
	}

	/// Add a video track to the catalog.
	pub fn add_video(&mut self, video: catalog::Video) {
		let mut current = self.current.lock().unwrap();
		current.video.push(video);
	}

	/// Add an audio track to the catalog.
	pub fn add_audio(&mut self, audio: catalog::Audio) {
		let mut current = self.current.lock().unwrap();
		current.audio.push(audio);
	}

	/// Set the location information in the catalog.
	pub fn set_location(&mut self, location: Option<catalog::Location>) {
		let mut current = self.current.lock().unwrap();
		current.location = location;
	}

	/// Remove a video track from the catalog.
	pub fn remove_video(&mut self, video: &catalog::Video) {
		let mut current = self.current.lock().unwrap();
		current.video.retain(|v| v != video);
	}

	/// Remove an audio track from the catalog.
	pub fn remove_audio(&mut self, audio: &catalog::Audio) {
		let mut current = self.current.lock().unwrap();
		current.audio.retain(|a| a != audio);
	}

	/// Get mutable access to the catalog for manual updates.
	/// Remember to call [`publish`](Self::publish) after making changes.
	pub fn update(&mut self) -> MutexGuard<'_, catalog::Root> {
		self.current.lock().unwrap()
	}

	/// Publish the current catalog to all subscribers.
	///
	/// This serializes the catalog to JSON and sends it as a new group on the
	/// catalog track. All changes made since the last publish will be included.
	pub fn publish(&mut self) {
		let current = self.current.lock().unwrap();
		let mut group = self.track.append_group();

		// TODO decide if this should return an error, or be impossible to fail
		let frame = current.to_string().expect("invalid catalog");
		group.write_frame(frame);
		group.close();
	}

	/// Create a consumer for this catalog, receiving updates as they're [published](Self::publish).
	pub fn consume(&self) -> CatalogConsumer {
		CatalogConsumer::new(self.track.consume())
	}

	/// Finish publishing to this catalog and close the track.
	pub fn close(self) {
		self.track.close();
	}
}

impl From<moq_lite::TrackProducer> for CatalogProducer {
	fn from(inner: moq_lite::TrackProducer) -> Self {
		Self::new(inner, catalog::Root::default())
	}
}

/// A catalog consumer, used to receive catalog updates and discover tracks.
///
/// This wraps a `moq_lite::TrackConsumer` and automatically deserializes JSON
/// catalog data to discover available audio and video tracks in a broadcast.
#[derive(Clone)]
pub struct CatalogConsumer {
	/// Access to the underlying track consumer.
	pub track: moq_lite::TrackConsumer,
	group: Option<moq_lite::GroupConsumer>,
}

impl CatalogConsumer {
	/// Create a new catalog consumer from a MoQ track consumer.
	pub fn new(track: moq_lite::TrackConsumer) -> Self {
		Self { track, group: None }
	}

	/// Get the next catalog update.
	///
	/// This method waits for the next catalog publication and returns the
	/// catalog data. If there are no more updates, `None` is returned.
	pub async fn next(&mut self) -> Result<Option<catalog::Root>> {
		loop {
			tokio::select! {
				res = self.track.next_group() => {
					match res? {
						Some(group) => {
							// Use the new group.
							self.group = Some(group);
						}
						// The track has ended, so we should return None.
						None => return Ok(None),
					}
				},
				Some(frame) = async { self.group.as_mut()?.read_frame().await.transpose() } => {
					self.group.take(); // We don't support deltas yet
					let catalog = catalog::Root::from_slice(&frame?)?;
					return Ok(Some(catalog));
				}
			}
		}
	}

	/// Wait until the catalog track is closed.
	pub async fn closed(&self) -> Result<()> {
		Ok(self.track.closed().await?)
	}
}

impl From<moq_lite::TrackConsumer> for CatalogConsumer {
	fn from(inner: moq_lite::TrackConsumer) -> Self {
		Self::new(inner)
	}
}
