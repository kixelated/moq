use super::{ErrorCode, RecvStream, SendStream, Session};

use bytes::{Buf, BufMut, Bytes};

impl Session for web_transport_quinn::Session {
	type SendStream = web_transport_quinn::SendStream;
	type RecvStream = web_transport_quinn::RecvStream;
	type Error = web_transport_quinn::SessionError;

	async fn accept_uni(&self) -> Result<Self::RecvStream, Self::Error> {
		Self::accept_uni(self).await
	}

	async fn accept_bi(&self) -> Result<(Self::SendStream, Self::RecvStream), Self::Error> {
		Self::accept_bi(self).await
	}

	async fn open_bi(&self) -> Result<(Self::SendStream, Self::RecvStream), Self::Error> {
		Self::open_bi(self).await
	}

	async fn open_uni(&self) -> Result<Self::SendStream, Self::Error> {
		Self::open_uni(self).await
	}

	fn close(&self, code: u32, reason: &[u8]) {
		Self::close(self, code, reason);
	}

	async fn closed(&self) -> Self::Error {
		Self::closed(self).await
	}
}

impl SendStream for web_transport_quinn::SendStream {
	type Error = web_transport_quinn::WriteError;

	fn set_priority(&mut self, order: i32) {
		Self::set_priority(self, order).ok();
	}

	fn reset(&mut self, code: u32) {
		Self::reset(self, code).ok();
	}

	fn finish(&mut self) -> Result<(), Self::Error> {
		Self::finish(self).map_err(|_| web_transport_quinn::WriteError::ClosedStream)
	}

	async fn write(&mut self, buf: &[u8]) -> Result<usize, Self::Error> {
		Self::write(self, buf).await
	}

	async fn write_buf<B: Buf + Send + Sync>(&mut self, buf: &mut B) -> Result<usize, Self::Error> {
		let size = self.write(buf.chunk()).await?;
		buf.advance(size);
		Ok(size)
	}

	async fn closed(&mut self) -> Result<Option<u8>, Self::Error> {
		match self.stopped().await {
			Ok(None) => Ok(None),
			Ok(Some(code)) => Ok(Some(code as u8)),
			Err(e) => Err(e.into()),
		}
	}
}

impl RecvStream for web_transport_quinn::RecvStream {
	type Error = web_transport_quinn::ReadError;

	fn stop(&mut self, code: u32) {
		Self::stop(self, code).ok();
	}

	async fn read_buf<B: BufMut>(&mut self, buf: &mut B) -> Result<Option<usize>, Self::Error> {
		let dst = buf.chunk_mut();
		let dst = unsafe { &mut *(dst as *mut _ as *mut [u8]) };

		let size = match self.read(dst).await? {
			Some(size) => size,
			None => return Ok(None),
		};

		unsafe { buf.advance_mut(size) };

		Ok(Some(size))
	}

	async fn read_chunk(&mut self, max_size: usize) -> Result<Option<Bytes>, Self::Error> {
		Self::read_chunk(self, max_size, true)
			.await
			.map(|r| r.map(|chunk| chunk.bytes))
	}
}

impl ErrorCode for web_transport_quinn::SessionError {}
impl ErrorCode for web_transport_quinn::WriteError {}
impl ErrorCode for web_transport_quinn::ReadError {}
