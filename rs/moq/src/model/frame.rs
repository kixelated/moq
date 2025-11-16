use bytes::{Bytes, BytesMut};
use tokio::sync::watch;

use crate::{Error, Produce, Result};

#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Frame {
	pub size: u64,
}

impl Frame {
	pub fn produce(self) -> Produce<FrameProducer, FrameConsumer> {
		let producer = FrameProducer::new(self);
		let consumer = producer.consume();
		Produce { producer, consumer }
	}
}

impl From<usize> for Frame {
	fn from(size: usize) -> Self {
		Self { size: size as u64 }
	}
}

impl From<u64> for Frame {
	fn from(size: u64) -> Self {
		Self { size }
	}
}

impl From<u32> for Frame {
	fn from(size: u32) -> Self {
		Self { size: size as u64 }
	}
}

impl From<u16> for Frame {
	fn from(size: u16) -> Self {
		Self { size: size as u64 }
	}
}

#[derive(Default)]
struct FrameState {
	// The chunks that has been written thus far
	chunks: Vec<Bytes>,

	// Set when the writer or all readers are dropped.
	closed: Option<Result<()>>,
}

impl FrameState {
	pub fn write_chunk(&mut self, chunk: Bytes) -> Result<()> {
		if let Some(res) = &self.closed {
			return Err(res.clone().err().unwrap_or(Error::Closed));
		}

		self.chunks.push(chunk);
		Ok(())
	}

	pub fn close(&mut self) -> Result<()> {
		if let Some(Err(err)) = &self.closed {
			return Err(err.clone());
		}

		self.closed = Some(Ok(()));
		Ok(())
	}
}

/// Used to write a frame's worth of data in chunks.
#[derive(Clone)]
pub struct FrameProducer {
	// Immutable stream state.
	pub info: Frame,

	// Mutable stream state.
	state: watch::Sender<FrameState>,

	// Sanity check to ensure we don't write more than the frame size.
	written: usize,
}

impl FrameProducer {
	fn new(info: Frame) -> Self {
		Self {
			info,
			state: Default::default(),
			written: 0,
		}
	}

	/// Write a chunk to the frame.
	///
	/// Returns an error if the chunk is too large or the frame has already been aborted.
	pub fn write_chunk<B: Into<Bytes>>(&mut self, chunk: B) -> Result<()> {
		let chunk = chunk.into();
		let len = chunk.len();

		if self.written + len > self.info.size as usize {
			return Err(Error::WrongSize);
		}

		let mut result = Ok(());
		self.state.send_if_modified(|state| {
			result = state.write_chunk(chunk);
			result.is_ok()
		});

		result?;
		self.written += len;

		Ok(())
	}

	/// Close the producer once the last chunk has been written.
	///
	/// Returns an error if the frame is not full or has already been aborted.
	pub fn close(&mut self) -> Result<()> {
		if self.written != self.info.size as usize {
			return Err(Error::WrongSize);
		}

		let mut result = Ok(());
		self.state.send_if_modified(|state| {
			result = state.close();
			result.is_ok()
		});

		result
	}

	/// Immediately abort the producer with an error.
	///
	/// This returns an error immediately to any consumers.
	pub fn abort(&mut self, err: Error) {
		self.state.send_modify(|state| state.closed = Some(Err(err)));
	}

	/// Create a new consumer for the frame.
	pub fn consume(&self) -> FrameConsumer {
		FrameConsumer {
			info: self.info.clone(),
			state: self.state.subscribe(),
			index: 0,
		}
	}

	/// Proxy all chunks and errors from the given consumer.
	///
	/// This takes ownership of the frame and publishes identical chunks to the other consumer.
	/// Returns an error on an unexpected close, which can happen if the [FrameProducer] is cloned.
	pub async fn proxy(mut self, other: FrameConsumer) -> Result<()> {
		let mut chunks = Some(other.clone());
		loop {
			tokio::select! {
				biased;
				Some(chunk) = async { Some(chunks.as_mut()?.read_chunk().await) } => match chunk {
					Ok(Some(chunk)) => self.write_chunk(chunk)?,
					Ok(None) => {
						chunks = None;
						self.close()?
					},
					Err(err) => {
						self.abort(err);
						break
					},
				},
				Err(err) = other.closed() => {
					self.abort(err);
					break
				},
				else => break,
			}
		}

		Ok(())
	}
}

impl From<Frame> for FrameProducer {
	fn from(info: Frame) -> Self {
		FrameProducer::new(info)
	}
}

/// Used to consume a frame's worth of data in chunks.
#[derive(Clone)]
pub struct FrameConsumer {
	// Immutable stream state.
	pub info: Frame,

	// Modify the stream state.
	state: watch::Receiver<FrameState>,

	// The number of frames we've read.
	// NOTE: Cloned readers inherit this offset, but then run in parallel.
	index: usize,
}

impl FrameConsumer {
	// Return the next chunk, or None if the frame is finished.
	pub async fn read_chunk(&mut self) -> Result<Option<Bytes>> {
		loop {
			{
				let state = self.state.borrow_and_update();

				if let Some(Err(err)) = &state.closed {
					return Err(err.clone());
				}

				if let Some(chunk) = state.chunks.get(self.index).cloned() {
					self.index += 1;
					return Ok(Some(chunk));
				}

				if let Some(Ok(_)) = &state.closed {
					return Ok(None);
				}
			}

			if self.state.changed().await.is_err() {
				return Err(Error::Dropped);
			}
		}
	}

	// Return all of the remaining chunks concatenated together.
	pub async fn read_all(&mut self) -> Result<Bytes> {
		// Wait until the writer is done before even attempting to read.
		// That way this function can be cancelled without consuming half of the frame.
		let state = match self.state.wait_for(|state| state.closed.is_some()).await {
			Ok(state) => {
				if let Some(Err(err)) = &state.closed {
					return Err(err.clone());
				}
				state
			}
			Err(_) => return Err(Error::Dropped),
		};

		// Get all of the remaining chunks.
		let chunks = &state.chunks[self.index..];
		self.index = state.chunks.len();

		// We know the final size so we can allocate the buffer upfront.
		let size = chunks.iter().map(Bytes::len).sum();

		// We know the final size so we can allocate the buffer upfront.
		let mut buf = BytesMut::with_capacity(size);

		// Copy the chunks into the buffer.
		for chunk in chunks {
			buf.extend_from_slice(chunk);
		}

		Ok(buf.freeze())
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
	async fn test_frame_basic_write_read() {
		let frame = Frame::produce(10u64.into());
		let mut producer = frame.producer;
		let mut consumer = frame.consumer;

		producer.write_chunk(&b"hello"[..]).unwrap();
		producer.write_chunk(&b"world"[..]).unwrap();
		producer.close().unwrap();

		let chunk1 = consumer.read_chunk().await.unwrap();
		assert_eq!(chunk1, Some(Bytes::from_static(b"hello")));

		let chunk2 = consumer.read_chunk().await.unwrap();
		assert_eq!(chunk2, Some(Bytes::from_static(b"world")));

		let chunk3 = consumer.read_chunk().await.unwrap();
		assert_eq!(chunk3, None);
	}

	#[tokio::test]
	async fn test_frame_read_all() {
		let frame = Frame::produce(10u64.into());
		let mut producer = frame.producer;
		let mut consumer = frame.consumer;

		producer.write_chunk(&b"hello"[..]).unwrap();
		producer.write_chunk(&b"world"[..]).unwrap();
		producer.close().unwrap();

		let all = consumer.read_all().await.unwrap();
		assert_eq!(all, Bytes::from_static(b"helloworld"));
	}

	#[tokio::test]
	async fn test_frame_wrong_size_too_large() {
		let frame = Frame::produce(5u64.into());
		let mut producer = frame.producer;

		let result = producer.write_chunk(&b"toolong"[..]);
		assert!(result.is_err());
	}

	#[tokio::test]
	async fn test_frame_wrong_size_too_small() {
		let frame = Frame::produce(10u64.into());
		let mut producer = frame.producer;

		producer.write_chunk(&b"short"[..]).unwrap();
		let result = producer.close();
		assert!(result.is_err());
	}

	#[tokio::test]
	async fn test_frame_abort() {
		let frame = Frame::produce(10u64.into());
		let mut producer = frame.producer;
		let mut consumer = frame.consumer;

		producer.write_chunk(&b"hello"[..]).unwrap();
		producer.abort(Error::Expired);

		let result = consumer.read_chunk().await;
		assert!(result.is_err());
	}

	#[tokio::test]
	async fn test_frame_abort_before_read() {
		let frame = Frame::produce(10u64.into());
		let mut producer = frame.producer;
		let consumer = frame.consumer;

		producer.abort(Error::Expired);

		let result = consumer.closed().await;
		assert!(result.is_err());
	}

	#[tokio::test]
	async fn test_frame_multiple_consumers() {
		let frame = Frame::produce(10u64.into());
		let mut producer = frame.producer;
		let mut consumer1 = frame.consumer.clone();
		let mut consumer2 = frame.consumer;

		producer.write_chunk(&b"hello"[..]).unwrap();
		producer.write_chunk(&b"world"[..]).unwrap();
		producer.close().unwrap();

		let all1 = consumer1.read_all().await.unwrap();
		let all2 = consumer2.read_all().await.unwrap();

		assert_eq!(all1, Bytes::from_static(b"helloworld"));
		assert_eq!(all2, Bytes::from_static(b"helloworld"));
	}

	#[tokio::test]
	async fn test_frame_write_after_close() {
		let frame = Frame::produce(5u64.into());
		let mut producer = frame.producer;

		producer.write_chunk(&b"hello"[..]).unwrap();
		producer.close().unwrap();

		let result = producer.write_chunk(&b"extra"[..]);
		assert!(result.is_err());
	}

	#[tokio::test]
	async fn test_frame_proxy() {
		let source = Frame::produce(10u64.into());
		let mut source_producer = source.producer;
		let source_consumer = source.consumer;

		let dest = Frame::produce(10u64.into());
		let dest_producer = dest.producer;
		let mut dest_consumer = dest.consumer;

		source_producer.write_chunk(&b"hello"[..]).unwrap();
		source_producer.write_chunk(&b"world"[..]).unwrap();
		source_producer.close().unwrap();

		let proxy_task = tokio::spawn(dest_producer.proxy(source_consumer));

		let all = dest_consumer.read_all().await.unwrap();
		assert_eq!(all, Bytes::from_static(b"helloworld"));

		proxy_task.await.unwrap().unwrap();
	}
}
