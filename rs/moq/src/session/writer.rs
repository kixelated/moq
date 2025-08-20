use crate::{coding::*, Error};

// A wrapper around a SendStream that will reset on Drop
pub(super) struct Writer<S: web_transport_generic::SendStream> {
	stream: S,
	buffer: bytes::BytesMut,
}

impl<S: web_transport_generic::SendStream> Writer<S> {
	pub fn new(stream: S) -> Self {
		Self {
			stream,
			buffer: Default::default(),
		}
	}

	/*
	pub async fn open<S: transport::Session>(session: &S, typ: message::DataType) -> Result<Self, Error>
	where
		S::SendStream: T,
	{
		let send = session.open_uni().await?;

		let mut writer = Self::new(send);
		writer.encode(&typ).await?;

		Ok(writer)
	}
	*/

	pub async fn encode<T: Encode>(&mut self, msg: &T) -> Result<(), Error> {
		self.buffer.clear();
		msg.encode(&mut self.buffer);

		while !self.buffer.is_empty() {
			self.stream
				.write_buf(&mut self.buffer)
				.await
				.map_err(|e| Error::Transport(e.into()))?;
		}

		Ok(())
	}

	pub async fn write(&mut self, buf: &[u8]) -> Result<(), Error> {
		self.stream.write(buf).await.map_err(|e| Error::Transport(e.into()))?;
		Ok(())
	}

	/// A clean termination of the stream, waiting for the peer to close.
	pub async fn finish(&mut self) -> Result<(), Error> {
		self.stream.finish().await.map_err(|e| Error::Transport(e.into()))?;
		Ok(())
	}

	pub fn abort(&mut self, err: &Error) {
		self.stream.reset(err.to_code());
	}

	pub async fn closed(&mut self) -> Result<(), Error> {
		self.stream.closed().await.map_err(|e| Error::Transport(e.into()))?;
		Ok(())
	}
}

impl<S: web_transport_generic::SendStream> Drop for Writer<S> {
	fn drop(&mut self) {
		// Unlike the Quinn default, we abort the stream on drop.
		self.stream.reset(Error::Cancel.to_code());
	}
}
