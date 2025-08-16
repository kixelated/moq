use super::{ErrorCode, RecvStream, SendStream, Session};
use crate::coding::{Decode, DecodeError, Encode, VarInt};
use bytes::{Buf, BufMut, Bytes, BytesMut};
use futures::stream::{SplitSink, SplitStream};
use futures::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::ops::RangeInclusive;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex, RwLock};
use tokio_tungstenite::{tungstenite, WebSocketStream};
use tungstenite::Message;

/// Error types for WebSocket transport
#[derive(Debug, thiserror::Error)]
pub enum WebSocketError {
	#[error("WebSocket error: {0}")]
	WebSocket(#[from] tungstenite::Error),

	#[error("Protocol violation: {0}")]
	ProtocolViolation(String),

	#[error("Stream closed")]
	StreamClosed,

	#[error("Connection closed: {code}: {reason}")]
	ConnectionClosed { code: VarInt, reason: String },

	#[error("Stream reset: {0}")]
	StreamReset(VarInt),

	#[error("IO error: {0}")]
	Io(#[from] std::io::Error),

	#[error("Decode error: {0}")]
	Decode(#[from] DecodeError),

	#[error("Invalid frame type: {0}")]
	InvalidFrameType(u8),
}

impl ErrorCode for WebSocketError {}

impl Clone for WebSocketError {
	fn clone(&self) -> Self {
		match self {
			Self::WebSocket(e) => Self::ProtocolViolation(format!("WebSocket error: {}", e)),
			Self::ProtocolViolation(s) => Self::ProtocolViolation(s.clone()),
			Self::StreamClosed => Self::StreamClosed,
			Self::ConnectionClosed { code, reason } => Self::ConnectionClosed {
				code: *code,
				reason: reason.clone(),
			},
			Self::StreamReset(code) => Self::StreamReset(*code),
			Self::Io(e) => Self::Io(std::io::Error::new(e.kind(), e.to_string())),
			Self::Decode(e) => Self::ProtocolViolation(format!("Decode error: {}", e)),
			Self::InvalidFrameType(t) => Self::InvalidFrameType(*t),
		}
	}
}

/// Stream direction
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Dir {
	Bi,
	Uni,
}

/// Stream ID with direction encoding (QUIC-style)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct StreamId(VarInt);

impl StreamId {
	fn new(id: u64, dir: Dir, is_server: bool) -> Self {
		let mut stream_id = id << 2;
		if dir == Dir::Uni {
			stream_id |= 0x02;
		}
		if is_server {
			stream_id |= 0x01;
		}
		StreamId(VarInt::try_from(stream_id).expect("stream ID too large"))
	}

	fn dir(&self) -> Dir {
		if self.0.into_inner() & 0x02 != 0 {
			Dir::Uni
		} else {
			Dir::Bi
		}
	}

	#[allow(dead_code)]
	fn is_server(&self) -> bool {
		self.0.into_inner() & 0x01 != 0
	}

	#[allow(dead_code)]
	fn id(&self) -> u64 {
		self.0.into_inner() >> 2
	}

	fn into_inner(&self) -> u64 {
		self.0.into_inner()
	}
}

/// QUIC Frame types (subset for WebSocket transport)
#[derive(Debug, Clone, Copy)]
#[repr(u8)]
enum FrameType {
	Padding = 0x00,
	Ping = 0x01,
	ResetStream = 0x04,
	StopSending = 0x05,
	#[allow(dead_code)]
	Stream = 0x08, // Base type, actual value depends on flags
	ConnectionClose = 0x1c,
	ApplicationClose = 0x1d,
}

const STREAM_TYS: RangeInclusive<u8> = 0x08..=0x0f;

/// QUIC-compatible frames for WebSocket transport
#[derive(Debug)]
enum Frame {
	Padding,
	Ping,
	ResetStream {
		stream_id: StreamId,
		error_code: VarInt,
		final_size: VarInt,
	},
	StopSending {
		stream_id: StreamId,
		error_code: VarInt,
	},
	Stream {
		stream_id: StreamId,
		offset: VarInt,
		data: Bytes,
		fin: bool,
	},
	ConnectionClose {
		error_code: VarInt,
		reason: String,
	},
	ApplicationClose {
		error_code: VarInt,
		reason: String,
	},
}

impl Frame {
	fn encode(&self) -> Bytes {
		let mut buf = BytesMut::new();

		match self {
			Frame::Padding => {
				buf.put_u8(FrameType::Padding as u8);
			}
			Frame::Ping => {
				buf.put_u8(FrameType::Ping as u8);
			}
			Frame::ResetStream {
				stream_id,
				error_code,
				final_size,
			} => {
				buf.put_u8(FrameType::ResetStream as u8);
				stream_id.0.encode(&mut buf);
				error_code.encode(&mut buf);
				final_size.encode(&mut buf);
			}
			Frame::StopSending { stream_id, error_code } => {
				buf.put_u8(FrameType::StopSending as u8);
				stream_id.0.encode(&mut buf);
				error_code.encode(&mut buf);
			}
			Frame::Stream {
				stream_id,
				offset,
				data,
				fin,
			} => {
				// Calculate frame type based on flags
				let mut frame_type = 0x08u8;
				if *fin {
					frame_type |= 0x01;
				}
				if offset.into_inner() != 0 {
					frame_type |= 0x04;
				}
				// Always set length bit
				frame_type |= 0x02;

				buf.put_u8(frame_type);
				stream_id.0.encode(&mut buf);

				if offset.into_inner() != 0 {
					offset.encode(&mut buf);
				}

				// Always encode length
				let len = VarInt::try_from(data.len()).expect("data too large");
				len.encode(&mut buf);
				buf.put_slice(data);
			}
			Frame::ConnectionClose { error_code, reason } => {
				buf.put_u8(FrameType::ConnectionClose as u8);
				error_code.encode(&mut buf);
				VarInt::ZERO.encode(&mut buf); // Frame type that triggered error (0 for none)
				let len = VarInt::try_from(reason.len()).expect("reason too long");
				len.encode(&mut buf);
				buf.put_slice(reason.as_bytes());
			}
			Frame::ApplicationClose { error_code, reason } => {
				buf.put_u8(FrameType::ApplicationClose as u8);
				error_code.encode(&mut buf);
				let len = VarInt::try_from(reason.len()).expect("reason too long");
				len.encode(&mut buf);
				buf.put_slice(reason.as_bytes());
			}
		}

		buf.freeze()
	}

	fn decode(mut data: Bytes) -> Result<Self, WebSocketError> {
		if data.is_empty() {
			return Err(DecodeError::Short.into());
		}

		let frame_type = data.get_u8();

		match frame_type {
			0x00 => Ok(Frame::Padding),
			0x01 => Ok(Frame::Ping),
			0x04 => {
				let stream_id = StreamId(VarInt::decode(&mut data)?);
				let error_code = VarInt::decode(&mut data)?;
				let final_size = VarInt::decode(&mut data)?;
				Ok(Frame::ResetStream {
					stream_id,
					error_code,
					final_size,
				})
			}
			0x05 => {
				let stream_id = StreamId(VarInt::decode(&mut data)?);
				let error_code = VarInt::decode(&mut data)?;
				Ok(Frame::StopSending { stream_id, error_code })
			}
			ty if STREAM_TYS.contains(&ty) => {
				let stream_id = StreamId(VarInt::decode(&mut data)?);

				let offset = if ty & 0x04 != 0 {
					VarInt::decode(&mut data)?
				} else {
					VarInt::ZERO
				};

				let length = if ty & 0x02 != 0 {
					VarInt::decode(&mut data)?.into_inner() as usize
				} else {
					data.len()
				};

				if data.len() < length {
					return Err(DecodeError::Short.into());
				}

				let stream_data = data.split_to(length);
				let fin = ty & 0x01 != 0;

				Ok(Frame::Stream {
					stream_id,
					offset,
					data: stream_data,
					fin,
				})
			}
			0x1c => {
				let error_code = VarInt::decode(&mut data)?;
				let _frame_type = VarInt::decode(&mut data)?; // Frame type that triggered error
				let reason_len = VarInt::decode(&mut data)?.into_inner() as usize;

				if data.len() < reason_len {
					return Err(DecodeError::Short.into());
				}

				let reason = String::from_utf8_lossy(&data[..reason_len]).into_owned();
				Ok(Frame::ConnectionClose { error_code, reason })
			}
			0x1d => {
				let error_code = VarInt::decode(&mut data)?;
				let reason_len = VarInt::decode(&mut data)?.into_inner() as usize;

				if data.len() < reason_len {
					return Err(DecodeError::Short.into());
				}

				let reason = String::from_utf8_lossy(&data[..reason_len]).into_owned();
				Ok(Frame::ApplicationClose { error_code, reason })
			}
			_ => Err(WebSocketError::InvalidFrameType(frame_type)),
		}
	}
}

/// Internal stream state
struct StreamState {
	recv_buffer: BytesMut,
	recv_offset: u64,
	recv_closed: bool,
	send_offset: u64,
	send_closed: bool,
	reset_code: Option<VarInt>,
	stop_code: Option<VarInt>,
	final_size: Option<u64>,
}

/// WebSocket session implementation
#[derive(Clone)]
pub struct WebSocketSession {
	inner: Arc<WebSocketSessionInner>,
}

struct WebSocketSessionInner {
	streams: Arc<RwLock<HashMap<u64, Arc<Mutex<StreamState>>>>>,
	next_stream_id: AtomicU64,
	writer_tx: mpsc::UnboundedSender<Frame>,

	// Channels for accepting streams
	uni_accept_tx: mpsc::UnboundedSender<StreamId>,
	uni_accept_rx: Arc<Mutex<mpsc::UnboundedReceiver<StreamId>>>,
	bi_accept_tx: mpsc::UnboundedSender<StreamId>,
	bi_accept_rx: Arc<Mutex<mpsc::UnboundedReceiver<StreamId>>>,

	closed: Arc<Mutex<Option<WebSocketError>>>,
	is_server: bool,
}

impl WebSocketSession {
	pub async fn new<S>(ws: WebSocketStream<S>, is_server: bool) -> Self
	where
		S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Send + Unpin + 'static,
	{
		let (ws_sink, ws_stream) = ws.split();
		let (writer_tx, writer_rx) = mpsc::unbounded_channel();
		let (uni_accept_tx, uni_accept_rx) = mpsc::unbounded_channel();
		let (bi_accept_tx, bi_accept_rx) = mpsc::unbounded_channel();

		let inner = Arc::new(WebSocketSessionInner {
			streams: Arc::new(RwLock::new(HashMap::new())),
			next_stream_id: AtomicU64::new(0),
			writer_tx: writer_tx.clone(),
			uni_accept_tx,
			uni_accept_rx: Arc::new(Mutex::new(uni_accept_rx)),
			bi_accept_tx,
			bi_accept_rx: Arc::new(Mutex::new(bi_accept_rx)),
			closed: Arc::new(Mutex::new(None)),
			is_server,
		});

		// Spawn writer task
		let inner_clone = inner.clone();
		tokio::spawn(async move {
			Self::writer_loop(ws_sink, writer_rx, inner_clone).await;
		});

		// Spawn reader task
		let inner_clone = inner.clone();
		tokio::spawn(async move {
			Self::reader_loop(ws_stream, inner_clone).await;
		});

		WebSocketSession { inner }
	}

	async fn writer_loop<S>(
		mut sink: SplitSink<WebSocketStream<S>, Message>,
		mut rx: mpsc::UnboundedReceiver<Frame>,
		inner: Arc<WebSocketSessionInner>,
	) where
		S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send,
	{
		while let Some(frame) = rx.recv().await {
			let data = frame.encode();
			if let Err(e) = sink.send(Message::Binary(data.to_vec())).await {
				let mut closed = inner.closed.lock().await;
				*closed = Some(WebSocketError::WebSocket(e));
				break;
			}
		}
	}

	async fn reader_loop<S>(mut stream: SplitStream<WebSocketStream<S>>, inner: Arc<WebSocketSessionInner>)
	where
		S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send,
	{
		while let Some(msg) = stream.next().await {
			let msg = match msg {
				Ok(msg) => msg,
				Err(e) => {
					let mut closed = inner.closed.lock().await;
					*closed = Some(WebSocketError::WebSocket(e));
					break;
				}
			};

			let data = match msg {
				Message::Binary(data) => Bytes::from(data),
				Message::Close(_) => {
					let mut closed = inner.closed.lock().await;
					*closed = Some(WebSocketError::StreamClosed);
					break;
				}
				_ => continue,
			};

			let frame = match Frame::decode(data) {
				Ok(frame) => frame,
				Err(e) => {
					let mut closed = inner.closed.lock().await;
					*closed = Some(e);
					break;
				}
			};

			if let Err(e) = Self::handle_frame(frame, &inner).await {
				let mut closed = inner.closed.lock().await;
				*closed = Some(e);
				break;
			}
		}
	}

	async fn handle_frame(frame: Frame, inner: &Arc<WebSocketSessionInner>) -> Result<(), WebSocketError> {
		match frame {
			Frame::Padding | Frame::Ping => {
				// These frames are no-ops in our implementation
			}
			Frame::Stream {
				stream_id,
				offset,
				data,
				fin,
			} => {
				let mut streams = inner.streams.write().await;

				// Check if this is a new stream from peer
				if !streams.contains_key(&stream_id.into_inner()) {
					// New stream from peer
					let state = Arc::new(Mutex::new(StreamState {
						recv_buffer: BytesMut::new(),
						recv_offset: 0,
						recv_closed: false,
						send_offset: 0,
						send_closed: false,
						reset_code: None,
						stop_code: None,
						final_size: None,
					}));
					streams.insert(stream_id.into_inner(), state.clone());

					// Notify about new stream
					if stream_id.dir() == Dir::Uni {
						inner.uni_accept_tx.send(stream_id).ok();
					} else {
						inner.bi_accept_tx.send(stream_id).ok();
					}
				}

				if let Some(stream) = streams.get(&stream_id.into_inner()) {
					let mut state = stream.lock().await;

					// Handle out-of-order data (simplified - just append)
					if offset.into_inner() == state.recv_offset {
						state.recv_buffer.extend_from_slice(&data);
						state.recv_offset += data.len() as u64;
					}

					if fin {
						state.recv_closed = true;
						state.final_size = Some(state.recv_offset);
					}
				}
			}
			Frame::ResetStream {
				stream_id,
				error_code,
				final_size,
			} => {
				let streams = inner.streams.read().await;
				if let Some(stream) = streams.get(&stream_id.into_inner()) {
					let mut state = stream.lock().await;
					state.reset_code = Some(error_code);
					state.recv_closed = true;
					state.final_size = Some(final_size.into_inner());
				}
			}
			Frame::StopSending { stream_id, error_code } => {
				let streams = inner.streams.read().await;
				if let Some(stream) = streams.get(&stream_id.into_inner()) {
					let mut state = stream.lock().await;
					state.stop_code = Some(error_code);
					state.send_closed = true;
				}
			}
			Frame::ConnectionClose { error_code, reason } | Frame::ApplicationClose { error_code, reason } => {
				let mut closed = inner.closed.lock().await;
				*closed = Some(WebSocketError::ConnectionClosed {
					code: error_code,
					reason,
				});
			}
		}
		Ok(())
	}

	fn get_next_stream_id(&self, dir: Dir) -> StreamId {
		let id = self.inner.next_stream_id.fetch_add(1, Ordering::SeqCst);
		StreamId::new(id, dir, self.inner.is_server)
	}
}

impl Session for WebSocketSession {
	type SendStream = WebSocketSendStream;
	type RecvStream = WebSocketRecvStream;
	type Error = WebSocketError;

	async fn accept_uni(&self) -> Result<Self::RecvStream, Self::Error> {
		let mut rx = self.inner.uni_accept_rx.lock().await;
		let stream_id = rx.recv().await.ok_or(WebSocketError::StreamClosed)?;

		Ok(WebSocketRecvStream {
			session: self.inner.clone(),
			stream_id,
		})
	}

	async fn accept_bi(&self) -> Result<(Self::SendStream, Self::RecvStream), Self::Error> {
		let mut rx = self.inner.bi_accept_rx.lock().await;
		let stream_id = rx.recv().await.ok_or(WebSocketError::StreamClosed)?;

		let send = WebSocketSendStream {
			session: self.inner.clone(),
			stream_id,
		};

		let recv = WebSocketRecvStream {
			session: self.inner.clone(),
			stream_id,
		};

		Ok((send, recv))
	}

	async fn open_bi(&self) -> Result<(Self::SendStream, Self::RecvStream), Self::Error> {
		// Check if connection is closed
		if let Some(ref _err) = *self.inner.closed.lock().await {
			return Err(WebSocketError::StreamClosed);
		}

		let stream_id = self.get_next_stream_id(Dir::Bi);

		// Create stream state
		let state = Arc::new(Mutex::new(StreamState {
			recv_buffer: BytesMut::new(),
			recv_offset: 0,
			recv_closed: false,
			send_offset: 0,
			send_closed: false,
			reset_code: None,
			stop_code: None,
			final_size: None,
		}));

		self.inner.streams.write().await.insert(stream_id.into_inner(), state);

		let send = WebSocketSendStream {
			session: self.inner.clone(),
			stream_id,
		};

		let recv = WebSocketRecvStream {
			session: self.inner.clone(),
			stream_id,
		};

		Ok((send, recv))
	}

	async fn open_uni(&self) -> Result<Self::SendStream, Self::Error> {
		// Check if connection is closed
		if let Some(ref _err) = *self.inner.closed.lock().await {
			return Err(WebSocketError::StreamClosed);
		}

		let stream_id = self.get_next_stream_id(Dir::Uni);

		// Create stream state
		let state = Arc::new(Mutex::new(StreamState {
			recv_buffer: BytesMut::new(),
			recv_offset: 0,
			recv_closed: false,
			send_offset: 0,
			send_closed: false,
			reset_code: None,
			stop_code: None,
			final_size: None,
		}));

		self.inner.streams.write().await.insert(stream_id.into_inner(), state);

		Ok(WebSocketSendStream {
			session: self.inner.clone(),
			stream_id,
		})
	}

	fn close(&self, code: u32, reason: &[u8]) {
		let reason_str = String::from_utf8_lossy(reason).into_owned();
		let error_code = VarInt::from(code);
		let frame = Frame::ApplicationClose {
			error_code,
			reason: reason_str,
		};

		self.inner.writer_tx.send(frame).ok();
	}

	async fn closed(&self) -> Self::Error {
		loop {
			if let Some(ref err) = *self.inner.closed.lock().await {
				return err.clone();
			}
			tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
		}
	}
}

/// WebSocket send stream implementation
pub struct WebSocketSendStream {
	session: Arc<WebSocketSessionInner>,
	stream_id: StreamId,
}

impl SendStream for WebSocketSendStream {
	type Error = WebSocketError;

	fn set_priority(&mut self, _order: i32) {
		// Priority not implemented in this version
	}

	fn reset(&mut self, code: u32) {
		let streams = self.session.streams.blocking_read();
		let final_size = if let Some(stream) = streams.get(&self.stream_id.into_inner()) {
			let state = stream.blocking_lock();
			VarInt::try_from(state.send_offset).unwrap_or(VarInt::MAX)
		} else {
			VarInt::ZERO
		};
		drop(streams);

		let frame = Frame::ResetStream {
			stream_id: self.stream_id,
			error_code: VarInt::from(code),
			final_size,
		};

		self.session.writer_tx.send(frame).ok();

		let streams = self.session.streams.blocking_read();
		if let Some(stream) = streams.get(&self.stream_id.into_inner()) {
			stream.blocking_lock().send_closed = true;
		}
	}

	fn finish(&mut self) -> Result<(), Self::Error> {
		// Get current offset to send proper FIN frame
		let streams = self.session.streams.blocking_read();
		let offset = if let Some(stream) = streams.get(&self.stream_id.into_inner()) {
			let state = stream.blocking_lock();
			VarInt::try_from(state.send_offset).unwrap_or(VarInt::ZERO)
		} else {
			VarInt::ZERO
		};
		drop(streams);

		let frame = Frame::Stream {
			stream_id: self.stream_id,
			offset,
			data: Bytes::new(),
			fin: true,
		};

		self.session
			.writer_tx
			.send(frame)
			.map_err(|_| WebSocketError::StreamClosed)?;

		let streams = self.session.streams.blocking_read();
		if let Some(stream) = streams.get(&self.stream_id.into_inner()) {
			stream.blocking_lock().send_closed = true;
		}

		Ok(())
	}

	async fn write(&mut self, buf: &[u8]) -> Result<usize, Self::Error> {
		// Check if stream is closed
		let streams = self.session.streams.read().await;
		let offset = if let Some(stream) = streams.get(&self.stream_id.into_inner()) {
			let mut state = stream.lock().await;
			if state.send_closed {
				return Err(WebSocketError::StreamClosed);
			}
			if state.stop_code.is_some() {
				return Err(WebSocketError::StreamClosed);
			}
			let offset = VarInt::try_from(state.send_offset)
				.map_err(|_| WebSocketError::ProtocolViolation("stream offset too large".into()))?;
			state.send_offset += buf.len() as u64;
			offset
		} else {
			return Err(WebSocketError::StreamClosed);
		};
		drop(streams);

		let frame = Frame::Stream {
			stream_id: self.stream_id,
			offset,
			data: Bytes::copy_from_slice(buf),
			fin: false,
		};

		self.session
			.writer_tx
			.send(frame)
			.map_err(|_| WebSocketError::StreamClosed)?;
		Ok(buf.len())
	}

	async fn write_buf<B: Buf + Send + Sync>(&mut self, buf: &mut B) -> Result<usize, Self::Error> {
		let chunk = buf.chunk();
		let size = self.write(chunk).await?;
		buf.advance(size);
		Ok(size)
	}

	async fn closed(&mut self) -> Result<Option<u8>, Self::Error> {
		let streams = self.session.streams.read().await;
		if let Some(stream) = streams.get(&self.stream_id.into_inner()) {
			let state = stream.lock().await;
			if let Some(code) = state.stop_code {
				return Ok(code.into_inner().try_into().ok());
			}
			if state.send_closed {
				return Ok(None);
			}
		}

		// Wait for close
		loop {
			tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
			let streams = self.session.streams.read().await;
			if let Some(stream) = streams.get(&self.stream_id.into_inner()) {
				let state = stream.lock().await;
				if let Some(code) = state.stop_code {
					return Ok(code.into_inner().try_into().ok());
				}
				if state.send_closed {
					return Ok(None);
				}
			} else {
				return Ok(None);
			}
		}
	}
}

/// WebSocket receive stream implementation
pub struct WebSocketRecvStream {
	session: Arc<WebSocketSessionInner>,
	stream_id: StreamId,
}

impl RecvStream for WebSocketRecvStream {
	type Error = WebSocketError;

	fn stop(&mut self, code: u32) {
		let frame = Frame::StopSending {
			stream_id: self.stream_id,
			error_code: VarInt::from(code),
		};

		self.session.writer_tx.send(frame).ok();

		let streams = self.session.streams.blocking_read();
		if let Some(stream) = streams.get(&self.stream_id.into_inner()) {
			stream.blocking_lock().recv_closed = true;
		}
	}

	async fn read_buf<B: BufMut + Send + Sync>(&mut self, buf: &mut B) -> Result<Option<usize>, Self::Error> {
		loop {
			let streams = self.session.streams.read().await;
			if let Some(stream) = streams.get(&self.stream_id.into_inner()) {
				let mut state = stream.lock().await;

				// Check for reset
				if let Some(code) = state.reset_code {
					return Err(WebSocketError::StreamReset(code));
				}

				// Read from buffer
				if !state.recv_buffer.is_empty() {
					let to_read = state.recv_buffer.len().min(buf.remaining_mut());
					buf.put_slice(&state.recv_buffer[..to_read]);
					state.recv_buffer.advance(to_read);
					return Ok(Some(to_read));
				}

				// Check if stream is closed
				if state.recv_closed {
					return Ok(None);
				}
			} else {
				return Ok(None);
			}
			drop(streams);

			// Wait for more data
			tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
		}
	}

	async fn read_chunk(&mut self, max_size: usize) -> Result<Option<Bytes>, Self::Error> {
		let mut buf = BytesMut::with_capacity(max_size);
		match self.read_buf(&mut buf).await? {
			Some(_) => Ok(Some(buf.freeze())),
			None => Ok(None),
		}
	}
}
