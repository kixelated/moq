use std::{cmp, io};

use bytes::{Buf, Bytes, BytesMut};

use crate::{coding::*, Error};

pub struct Reader {
	stream: web_transport::RecvStream,
	buffer: BytesMut,
}

impl Reader {
	pub fn new(stream: web_transport::RecvStream) -> Self {
		Self {
			stream,
			buffer: Default::default(),
		}
	}

	pub async fn accept(session: &mut web_transport::Session) -> Result<Self, Error> {
		let stream = session.accept_uni().await?;
		Ok(Self::new(stream))
	}

	pub async fn decode<T: Decode>(&mut self) -> Result<T, Error> {
		loop {
			let mut cursor = io::Cursor::new(&self.buffer);
			match T::decode(&mut cursor) {
				Ok(msg) => {
					self.buffer.advance(cursor.position() as usize);
					return Ok(msg);
				}
				Err(DecodeError::Short) => {
					// Try to read more data
					if self.stream.read_buf(&mut self.buffer).await?.is_none() {
						// Stream closed while we still need more data
						return Err(Error::Decode(DecodeError::Short));
					}
				}
				Err(e) => return Err(Error::Decode(e)),
			}
		}
	}

	// Decode optional messages at the end of a stream
	pub async fn decode_maybe<T: Decode>(&mut self) -> Result<Option<T>, Error> {
		match self.closed().await {
			Ok(()) => Ok(None),
			Err(Error::Decode(DecodeError::ExpectedEnd)) => Ok(Some(self.decode().await?)),
			Err(e) => Err(e),
		}
	}

	// Returns a non-zero chunk of data, or None if the stream is closed
	pub async fn read(&mut self, max: usize) -> Result<Option<Bytes>, Error> {
		if !self.buffer.is_empty() {
			let size = cmp::min(max, self.buffer.len());
			let data = self.buffer.split_to(size).freeze();
			return Ok(Some(data));
		}

		Ok(self.stream.read(max).await?)
	}

	/// Wait until the stream is closed, erroring if there are any additional bytes.
	pub async fn closed(&mut self) -> Result<(), Error> {
		if self.buffer.is_empty() && self.stream.read_buf(&mut self.buffer).await?.is_none() {
			return Ok(());
		}

		Err(DecodeError::ExpectedEnd.into())
	}

	pub fn abort(&mut self, err: &Error) {
		self.stream.stop(err.to_code());
	}
}
