use std::future::Future;

use bytes::{Buf, BufMut, Bytes};

pub trait ErrorCode: std::error::Error + Send + Sync + 'static {
	// TODO one day
	// fn code(&self) -> u32;
}

/// Trait representing a WebTransport session.
///
/// The Session can be cloned to produce multiple handles and each method is &self, mirroring the Quinn API.
/// This is overly permissive, but otherwise Quinn would need an extra Arc<Mutex<Session>> wrapper which would hurt performance.
pub trait Session: Clone + Send + Sync + 'static {
	type SendStream: SendStream;
	type RecvStream: RecvStream;
	type Error: ErrorCode;

	/// Accept an incoming unidirectional stream
	fn accept_uni(&self) -> impl Future<Output = Result<Self::RecvStream, Self::Error>> + Send + Sync;

	/// Accept an incoming bidirectional stream
	///
	/// Returning `None` implies the connection is closing or closed.
	fn accept_bi(
		&self,
	) -> impl Future<Output = Result<(Self::SendStream, Self::RecvStream), Self::Error>> + Send + Sync;

	/// Poll the connection to create a new bidirectional stream.
	fn open_bi(&self) -> impl Future<Output = Result<(Self::SendStream, Self::RecvStream), Self::Error>> + Send + Sync;

	/// Poll the connection to create a new unidirectional stream.
	fn open_uni(&self) -> impl Future<Output = Result<Self::SendStream, Self::Error>> + Send + Sync;

	/// Close the connection immediately
	fn close(&self, code: u32, reason: &[u8]);

	/// Check if the connection is closed, returning the error if it is.
	fn closed(&self) -> impl Future<Output = Self::Error> + Send + Sync;

	/*
	/// Check if there's a new datagram to read.
	fn recv_datagram(&self) -> impl Future<Output = Result<bytes::Bytes, Self::Error>> + Send + Sync;

	/// Send a datagram.
	fn send_datagram(&self, payload: bytes::Bytes) -> impl Future<Output = Result<(), Self::Error>> + Send + Sync;
	*/
}

/// A trait describing the "send" actions of a QUIC stream.
pub trait SendStream: Unpin + Send + Sync {
	type Error: ErrorCode;

	/// Set the stream's priority relative to other streams on the same connection.
	/// The **highest** priority stream with pending data will be sent first.
	/// Zero is the default value.
	fn set_priority(&mut self, order: i32);

	/// Send a QUIC reset code.
	fn reset(&mut self, code: u32);

	/// Finish the stream gracefully.
	fn finish(&mut self) -> Result<(), Self::Error>;

	/// Attempt to write some of the given buffer to the stream.
	fn write(&mut self, buf: &[u8]) -> impl Future<Output = Result<usize, Self::Error>> + Send + Sync;

	/// Attempt to write some of the given buffer to the stream.
	fn write_buf<B: Buf + Send + Sync>(
		&mut self,
		buf: &mut B,
	) -> impl Future<Output = Result<usize, Self::Error>> + Send + Sync;

	// Wait for the stream to be closed by the peer
	fn closed(&mut self) -> impl Future<Output = Result<Option<u8>, Self::Error>> + Send + Sync;
}

/// A trait describing the "receive" actions of a QUIC stream.
pub trait RecvStream: Unpin + Send + Sync {
	type Error: ErrorCode;

	/// Send a `STOP_SENDING` QUIC code.
	fn stop(&mut self, code: u32);

	/// Attempt to read from the stream into the given buffer.
	fn read_buf<B: BufMut + Send + Sync>(
		&mut self,
		buf: &mut B,
	) -> impl Future<Output = Result<Option<usize>, Self::Error>> + Send + Sync;

	/// Attempt to read a chunk from the stream.
	fn read_chunk(&mut self, max_size: usize)
		-> impl Future<Output = Result<Option<Bytes>, Self::Error>> + Send + Sync;
}
