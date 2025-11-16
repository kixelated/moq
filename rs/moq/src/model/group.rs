//! A group is a stream of frames, split into a [Producer] and [Consumer] handle.
//!
//! A [Producer] writes an ordered stream of frames.
//! Frames can be written all at once, or in chunks.
//!
//! A [Consumer] reads an ordered stream of frames.
//! The reader can be cloned, in which case each reader receives a copy of each frame. (fanout)
//!
//! The stream is closed with [ServeError::MoqError] when all writers or readers are dropped.
use std::future::Future;

use bytes::Bytes;
use futures::StreamExt;
use tokio::sync::watch;

use crate::{Error, Produce, Result};

use super::{Frame, FrameConsumer, FrameProducer};

#[derive(Clone, Debug, Hash, Eq, PartialEq, Ord, PartialOrd)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Group {
	pub sequence: u64,
}

impl Group {
	pub fn produce(self) -> Produce<GroupProducer, GroupConsumer> {
		let producer = GroupProducer::new(self);
		let consumer = producer.consume();
		Produce { producer, consumer }
	}
}

impl From<usize> for Group {
	fn from(sequence: usize) -> Self {
		Self {
			sequence: sequence as u64,
		}
	}
}

impl From<u64> for Group {
	fn from(sequence: u64) -> Self {
		Self { sequence }
	}
}

impl From<u32> for Group {
	fn from(sequence: u32) -> Self {
		Self {
			sequence: sequence as u64,
		}
	}
}

impl From<u16> for Group {
	fn from(sequence: u16) -> Self {
		Self {
			sequence: sequence as u64,
		}
	}
}

#[derive(Default)]
struct GroupState {
	// The frames that has been written thus far
	frames: Vec<FrameProducer>,

	// Whether the group is closed
	closed: Option<Result<()>>,
}

impl GroupState {
	pub fn append_frame(&mut self, producer: FrameProducer) -> Result<()> {
		if let Some(res) = &self.closed {
			return Err(res.clone().err().unwrap_or(Error::Closed));
		}

		self.frames.push(producer);
		Ok(())
	}

	pub fn close(&mut self) -> Result<()> {
		if let Some(Err(err)) = &self.closed {
			return Err(err.clone());
		}

		self.closed = Some(Ok(()));
		Ok(())
	}

	pub fn abort(&mut self, err: Error) {
		for frame in &mut self.frames {
			frame.abort(err.clone());
		}
		self.closed = Some(Err(err));
	}
}

/// Create a group, frame-by-frame.
#[derive(Clone)]
pub struct GroupProducer {
	// Mutable stream state.
	state: watch::Sender<GroupState>,

	// Immutable stream state.
	pub info: Group,
}

impl GroupProducer {
	fn new(info: Group) -> Self {
		Self {
			info,
			state: Default::default(),
		}
	}

	/// A helper method to write a frame from a single byte buffer.
	///
	/// If you want to write multiple chunks, use [Self::create_frame] or [Self::append_frame].
	/// That requires knowing the size upfront, but it can be more efficient.
	///
	/// Returns an error if the group is already closed.
	pub fn write_frame<B: Into<Bytes>>(&mut self, frame: B) -> Result<()> {
		let data = frame.into();
		let frame = Frame {
			size: data.len() as u64,
		};
		let mut frame = self.create_frame(frame)?;
		frame.write_chunk(data)?;
		frame.close()?;
		Ok(())
	}

	/// Create a frame with an upfront size
	///
	/// Returns an error if the group is already closed.
	pub fn create_frame(&mut self, info: Frame) -> Result<FrameProducer> {
		let frame = Frame::produce(info);
		self.append_frame(frame.producer.clone())?;
		Ok(frame.producer)
	}

	/// Append a frame to the group.
	///
	/// Returns an error if the group is already closed.
	pub fn append_frame(&mut self, frame: FrameProducer) -> Result<()> {
		let mut result = Ok(());
		self.state.send_if_modified(|state| {
			result = state.append_frame(frame);
			result.is_ok()
		});
		result
	}

	/// Clean termination of the group.
	///
	/// Returns an error if the group is already closed.
	pub fn close(&mut self) -> Result<()> {
		let mut result = Ok(());
		self.state.send_if_modified(|state| {
			result = state.close();
			result.is_ok()
		});
		result
	}

	/// Immediately abort the group with an error.
	pub fn abort(&mut self, err: Error) {
		self.state.send_modify(|state| state.abort(err));
	}

	/// Create a new consumer for the group.
	pub fn consume(&self) -> GroupConsumer {
		GroupConsumer {
			info: self.info.clone(),
			state: self.state.subscribe(),
			index: 0,
			active: None,
		}
	}

	pub fn unused(&self) -> impl Future<Output = ()> {
		let state = self.state.clone();
		async move {
			state.closed().await;
		}
	}

	/// Proxy all frames and errors from the given consumer.
	///
	/// This takes ownership of the group and publishes identical frames to the other consumer.
	///
	/// Returns an error on any unexpected close, which can happen if the [GroupProducer] is cloned.
	pub async fn proxy(mut self, other: GroupConsumer) -> Result<()> {
		let mut frames = Some(other.clone());
		let mut tasks = futures::stream::FuturesUnordered::new();

		loop {
			tokio::select! {
				biased;
				Some(frame) = async { Some(frames.as_mut()?.next_frame().await) } => {
					match frame {
						Ok(Some(frame)) => {
							let producer = self.create_frame(frame.info.clone())?;
							tasks.push(producer.proxy(frame));
						}
						Ok(None) => {
							// Stop trying to call next_frame.
							frames = None;
							self.close()?;
						}
						Err(err) => {
							self.abort(err);
							return Ok(());
						}
					}
				}
				// Abort early if the other consumer is closed.
				Err(err) = other.closed() => {
					self.abort(err);
					return Ok(());
				}
				// Wait until all groups have been proxied.
				Some(_) = tasks.next() => (),
				// We're done with the proxy.
				else => return Ok(()),
			}
		}
	}
}

impl From<Group> for GroupProducer {
	fn from(info: Group) -> Self {
		GroupProducer::new(info)
	}
}

/// Consume a group, frame-by-frame.
#[derive(Clone)]
pub struct GroupConsumer {
	// Modify the stream state.
	state: watch::Receiver<GroupState>,

	// Immutable stream state.
	pub info: Group,

	// The number of frames we've read.
	// NOTE: Cloned readers inherit this offset, but then run in parallel.
	index: usize,

	// Used to make read_frame cancel safe.
	active: Option<FrameConsumer>,
}

impl GroupConsumer {
	/// Read the next frame.
	pub async fn read_frame(&mut self) -> Result<Option<Bytes>> {
		// In order to be cancel safe, we need to save the active frame.
		// That way if this method gets cancelled, we can resume where we left off.
		if self.active.is_none() {
			self.active = self.next_frame().await?;
		};

		// Read the frame in one go, which is cancel safe.
		let frame = match self.active.as_mut() {
			Some(frame) => frame.read_all().await?,
			None => return Ok(None),
		};

		self.active = None;

		Ok(Some(frame))
	}

	/// Return a reader for the next frame.
	pub async fn next_frame(&mut self) -> Result<Option<FrameConsumer>> {
		// Just in case someone called read_frame, cancelled it, then called next_frame.
		if let Some(frame) = self.active.take() {
			return Ok(Some(frame));
		}

		loop {
			{
				let state = self.state.borrow_and_update();

				if let Some(frame) = state.frames.get(self.index).cloned() {
					self.index += 1;
					return Ok(Some(frame.consume()));
				}

				match &state.closed {
					Some(Ok(_)) => return Ok(None),
					Some(Err(err)) => return Err(err.clone()),
					_ => {}
				}
			}

			if self.state.changed().await.is_err() {
				return Err(Error::Cancel);
			}
		}
	}

	// Used to terminate the timeout task if we're already aborted.
	pub(super) async fn aborted(&self) -> Error {
		let mut state = self.state.clone();

		let state = state
			.wait_for(|state| state.closed.as_ref().map(|result| result.is_err()).unwrap_or(false))
			.await;

		match state {
			Ok(state) => match state.closed.clone() {
				Some(Ok(_)) => Error::Closed,
				Some(Err(err)) => err.clone(),
				None => Error::Cancel,
			},
			Err(_) => Error::Cancel,
		}
	}

	/// Block until the frame is closed.
	pub async fn closed(&self) -> Result<()> {
		match self.state.clone().wait_for(|state| state.closed.is_some()).await {
			Ok(state) => state.closed.clone().unwrap(),
			// close or abort was not called
			Err(_) => Err(Error::Dropped),
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[tokio::test]
	async fn test_group_basic_write_read() {
		let group = Group::produce(1u64.into());
		let mut producer = group.producer;
		let mut consumer = group.consumer;

		producer.write_frame(&b"frame1"[..]).unwrap();
		producer.write_frame(&b"frame2"[..]).unwrap();
		producer.close().unwrap();

		let frame1 = consumer.read_frame().await.unwrap();
		assert_eq!(frame1, Some(Bytes::from_static(b"frame1")));

		let frame2 = consumer.read_frame().await.unwrap();
		assert_eq!(frame2, Some(Bytes::from_static(b"frame2")));

		let frame3 = consumer.read_frame().await.unwrap();
		assert_eq!(frame3, None);
	}

	#[tokio::test]
	async fn test_group_next_frame() {
		let group = Group::produce(1u64.into());
		let mut producer = group.producer;
		let mut consumer = group.consumer;

		producer.write_frame(&b"test"[..]).unwrap();
		producer.close().unwrap();

		let mut frame = consumer.next_frame().await.unwrap().unwrap();
		let data = frame.read_all().await.unwrap();
		assert_eq!(data, Bytes::from_static(b"test"));

		let none = consumer.next_frame().await.unwrap();
		assert!(none.is_none());
	}

	#[tokio::test]
	async fn test_group_abort() {
		let group = Group::produce(1u64.into());
		let mut producer = group.producer;
		let mut consumer = group.consumer;

		// Create a frame
		let mut frame_producer = producer.create_frame(Frame { size: 6 }).unwrap();
		frame_producer.write_chunk(&b"frame1"[..]).unwrap();

		// Abort the group before closing the frame
		producer.abort(Error::Expired);

		// The group consumer should see the error
		let result = consumer.read_frame().await;
		assert!(result.is_err());

		// The frame should also be aborted (abort propagates from group to frames)
		let frame_result = frame_producer.close();
		assert!(frame_result.is_err());
	}

	#[tokio::test]
	async fn test_group_abort_before_read() {
		let group = Group::produce(1u64.into());
		let mut producer = group.producer;
		let consumer = group.consumer;

		producer.abort(Error::Expired);

		let result = consumer.closed().await;
		assert!(result.is_err());
	}

	#[tokio::test]
	async fn test_group_multiple_consumers() {
		let group = Group::produce(1u64.into());
		let mut producer = group.producer;
		let mut consumer1 = group.consumer.clone();
		let mut consumer2 = group.consumer;

		producer.write_frame(&b"frame1"[..]).unwrap();
		producer.write_frame(&b"frame2"[..]).unwrap();
		producer.close().unwrap();

		let f1_c1 = consumer1.read_frame().await.unwrap().unwrap();
		let f2_c1 = consumer1.read_frame().await.unwrap().unwrap();
		let f1_c2 = consumer2.read_frame().await.unwrap().unwrap();
		let f2_c2 = consumer2.read_frame().await.unwrap().unwrap();

		assert_eq!(f1_c1, Bytes::from_static(b"frame1"));
		assert_eq!(f2_c1, Bytes::from_static(b"frame2"));
		assert_eq!(f1_c2, Bytes::from_static(b"frame1"));
		assert_eq!(f2_c2, Bytes::from_static(b"frame2"));
	}

	#[tokio::test]
	async fn test_group_write_after_close() {
		let group = Group::produce(1u64.into());
		let mut producer = group.producer;

		producer.write_frame(&b"frame1"[..]).unwrap();
		producer.close().unwrap();

		let result = producer.write_frame(&b"frame2"[..]);
		assert!(result.is_err());
	}

	#[tokio::test]
	async fn test_group_create_frame() {
		let group = Group::produce(1u64.into());
		let mut producer = group.producer;
		let mut consumer = group.consumer;

		let mut frame = producer.create_frame(Frame { size: 5 }).unwrap();
		frame.write_chunk(&b"hello"[..]).unwrap();
		frame.close().unwrap();

		producer.close().unwrap();

		let data = consumer.read_frame().await.unwrap().unwrap();
		assert_eq!(data, Bytes::from_static(b"hello"));
	}

	#[tokio::test]
	async fn test_group_proxy() {
		let source = Group::produce(1u64.into());
		let mut source_producer = source.producer;
		let source_consumer = source.consumer;

		let dest = Group::produce(1u64.into());
		let dest_producer = dest.producer;
		let mut dest_consumer = dest.consumer;

		source_producer.write_frame(&b"frame1"[..]).unwrap();
		source_producer.write_frame(&b"frame2"[..]).unwrap();
		source_producer.close().unwrap();

		let proxy_task = tokio::spawn(dest_producer.proxy(source_consumer));

		let f1 = dest_consumer.read_frame().await.unwrap().unwrap();
		let f2 = dest_consumer.read_frame().await.unwrap().unwrap();
		let f3 = dest_consumer.read_frame().await.unwrap();

		assert_eq!(f1, Bytes::from_static(b"frame1"));
		assert_eq!(f2, Bytes::from_static(b"frame2"));
		assert!(f3.is_none());

		proxy_task.await.unwrap().unwrap();
	}

	#[tokio::test]
	async fn test_group_proxy_abort() {
		let source = Group::produce(1u64.into());
		let mut source_producer = source.producer;
		let source_consumer = source.consumer;

		let dest = Group::produce(1u64.into());
		let dest_producer = dest.producer;
		let dest_consumer = dest.consumer;

		source_producer.write_frame(&b"frame1"[..]).unwrap();
		source_producer.abort(Error::Expired);

		let proxy_task = tokio::spawn(dest_producer.proxy(source_consumer));

		let result = dest_consumer.closed().await;
		assert!(result.is_err());

		proxy_task.await.unwrap().unwrap();
	}
}
