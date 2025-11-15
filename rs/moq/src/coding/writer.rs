use std::{fmt::Debug, sync::Arc};

use crate::{coding::*, Error};

// A wrapper around a SendStream that will reset on Drop
pub struct Writer<S: web_transport_trait::SendStream> {
	stream: S,
	buffer: bytes::BytesMut,
}

impl<S: web_transport_trait::SendStream> Writer<S> {
	pub fn new(stream: S) -> Self {
		Self {
			stream,
			buffer: Default::default(),
		}
	}

	pub async fn encode<T: Encode + Debug>(&mut self, msg: &T) -> Result<(), Error> {
		self.buffer.clear();
		msg.encode(&mut self.buffer);

		while !self.buffer.is_empty() {
			self.stream
				.write_buf(&mut self.buffer)
				.await
				.map_err(|e| Error::Transport(Arc::new(e)))?;
		}

		Ok(())
	}

	// Not public to avoid accidental partial writes.
	async fn write<Buf: bytes::Buf + Send>(&mut self, buf: &mut Buf) -> Result<usize, Error> {
		self.stream
			.write_buf(buf)
			.await
			.map_err(|e| Error::Transport(Arc::new(e)))
	}

	// NOTE: We use Buf so we don't perform a copy when using Quinn.
	pub async fn write_all<Buf: bytes::Buf + Send>(&mut self, buf: &mut Buf) -> Result<(), Error> {
		while buf.has_remaining() {
			self.write(buf).await?;
		}
		Ok(())
	}

	/// A clean termination of the stream, waiting for the peer to close.
	pub fn finish(&mut self) -> Result<(), Error> {
		self.stream.finish().map_err(|e| Error::Transport(Arc::new(e)))
	}

	pub fn abort(&mut self, err: &Error) {
		self.stream.reset(err.to_code());
	}

	pub async fn closed(&mut self) -> Result<(), Error> {
		self.stream.closed().await.map_err(|e| Error::Transport(Arc::new(e)))?;
		Ok(())
	}
}

impl<S: web_transport_trait::SendStream> Drop for Writer<S> {
	fn drop(&mut self) {
		// Unlike the Quinn default, we abort the stream on drop.
		self.stream.reset(Error::Cancel.to_code());
	}
}
