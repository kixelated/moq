use bytes::{Buf, BytesMut};
use tokio::io::AsyncReadExt;

use crate::{self as hang, import::Aac};

use super::{Avc3, Fmp4};

#[derive(derive_more::From)]
enum Decoder {
	/// aka H264 with inline SPS/PPS
	Avc3(Avc3),
	Fmp4(Fmp4),
	Aac(Aac),
}

/// A generic interface for importing media into a hang broadcast.
///
/// If you know the format in advance, use the specific decoder instead.
pub struct Generic {
	decoder: Decoder,

	// Used for decoders that don't have timestamps in the stream.
	zero: Option<tokio::time::Instant>,

	// Buffer for data that has been read but not yet decoded.
	buffer: BytesMut,
}

impl Generic {
	/// Create a new decoder with the given format, or `None` if the format is not supported.
	pub fn new(broadcast: hang::BroadcastProducer, format: &str) -> Option<Self> {
		let decoder = match format {
			// NOTE: We don't support HEVC
			"avc3" => Avc3::new(broadcast).into(),
			"h264" => {
				// NOTE: avc1 is unsupported, because the SPS/PPS are out-of-band.
				tracing::warn!("'h264' format is deprecated, use 'avc3' instead");
				Avc3::new(broadcast).into()
			}
			"annex-b" => {
				tracing::warn!("'annex-b' format is deprecated, use 'avc3' instead");
				Avc3::new(broadcast).into()
			}
			"fmp4" | "cmaf" => Fmp4::new(broadcast).into(),
			"aac" => Aac::new(broadcast).into(),
			_ => return None,
		};

		Some(Self {
			decoder,
			zero: None,
			buffer: BytesMut::new(),
		})
	}

	/// Explicitly initialize the decoder with a given buffer.
	///
	/// Depending on the format, this may use a different encoding than `decode`.
	///
	/// The buffer MAY be partially consumed, in which case the caller needs to populate the buffer with more data.
	pub fn initialize<T: Buf + AsRef<[u8]>>(&mut self, buffer: &mut T) -> anyhow::Result<()> {
		match &mut self.decoder {
			Decoder::Avc3(decoder) => decoder.initialize(buffer)?,
			Decoder::Fmp4(decoder) => decoder.initialize(buffer)?,
			Decoder::Aac(decoder) => decoder.initialize(buffer)?,
		}

		Ok(())
	}

	/// Decode a frame from the given buffer and timestamp.
	///
	/// NOTE: Some formats do not need the timestamp and can ignore it.
	///
	/// If a timestamp is not provided but the format requires it, wall clock time will be used instead.
	pub fn decode<T: Buf + AsRef<[u8]>>(&mut self, buf: &mut T, pts: Option<hang::Timestamp>) -> anyhow::Result<()> {
		anyhow::ensure!(self.buffer.is_empty(), "TODO support partial decoding");

		// Make a function to compute the PTS timestamp only if needed by a decoder.
		// We want to avoid calling Instant::now() if not needed.
		let mut pts = || {
			pts.or_else(|| {
				self.zero = self.zero.or_else(|| Some(tokio::time::Instant::now()));
				hang::Timestamp::from_micros(self.zero.unwrap().elapsed().as_micros() as u64).ok()
			})
			.ok_or(crate::TimestampOverflow)
		};

		match &mut self.decoder {
			Decoder::Avc3(decoder) => decoder.decode(buf, pts()?),
			Decoder::Fmp4(decoder) => decoder.decode(buf),
			Decoder::Aac(decoder) => decoder.decode(buf, pts()?),
		}
	}

	pub fn is_initialized(&self) -> bool {
		match &self.decoder {
			Decoder::Avc3(decoder) => decoder.is_initialized(),
			Decoder::Fmp4(decoder) => decoder.is_initialized(),
			Decoder::Aac(decoder) => decoder.is_initialized(),
		}
	}

	/// A helper to keep calling decode until initialized.
	pub async fn initialize_from<T: AsyncReadExt + Unpin>(&mut self, input: &mut T) -> anyhow::Result<()> {
		while !self.is_initialized() && input.read_buf(&mut self.buffer).await? > 0 {
			let mut buffer = std::mem::take(&mut self.buffer);
			self.initialize(&mut buffer)?;
			self.buffer = buffer;
		}

		Ok(())
	}

	/// A helper to keep calling decode until the input is fully consumed.
	pub async fn decode_from<T: AsyncReadExt + Unpin>(&mut self, input: &mut T) -> anyhow::Result<()> {
		while input.read_buf(&mut self.buffer).await? > 0 {
			let mut buffer = std::mem::take(&mut self.buffer);
			self.decode(&mut buffer, None)?;
			self.buffer = buffer;
		}

		Ok(())
	}
}
