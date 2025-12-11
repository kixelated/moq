use bytes::Buf;

use crate::{self as hang, import::Aac};

use super::{Avc3, Fmp4};

#[derive(derive_more::From)]
enum Decoder {
	/// aka H264 with inline SPS/PPS
	Avc3(Avc3),
	// Boxed because it's a large struct and clippy complains about the size.
	Fmp4(Box<Fmp4>),
	Aac(Aac),
}

/// A generic interface for importing a stream of media into a hang broadcast.
///
/// If you know the format in advance, use the specific decoder instead.
pub struct DecoderStream {
	// The decoder for the given format.
	decoder: Decoder,

	// Used for decoders that don't have timestamps in the stream.
	zero: Option<tokio::time::Instant>,
}

impl DecoderStream {
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
			"fmp4" | "cmaf" => Box::new(Fmp4::new(broadcast)).into(),
			"aac" => Aac::new(broadcast).into(),
			_ => return None,
		};

		Some(Self { decoder, zero: None })
	}

	/// Decode any frames from the given buffer, if possible.
	///
	/// A timestamp can be provided, otherwise wall clock time will be used.
	/// NOTE: Some formats do not need the timestamp and can ignore it.
	pub fn decode<T: Buf + AsRef<[u8]>>(&mut self, buf: &mut T, pts: Option<hang::Timestamp>) -> anyhow::Result<()> {
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
			Decoder::Avc3(decoder) => decoder.decode_stream(buf, pts()?),
			Decoder::Fmp4(decoder) => decoder.decode(buf),
			Decoder::Aac(decoder) => decoder.decode(buf, pts()?),
		}
	}

	/// Check if the decoder has read enough data to be initialized.
	pub fn is_initialized(&self) -> bool {
		match &self.decoder {
			Decoder::Avc3(decoder) => decoder.is_initialized(),
			Decoder::Fmp4(decoder) => decoder.is_initialized(),
			Decoder::Aac(decoder) => decoder.is_initialized(),
		}
	}
}

/// A generic interface for importing a framed media into a hang broadcast.
///
/// If you know the format in advance, use the specific decoder instead.
pub struct DecoderFramed {
	// The decoder for the given format.
	decoder: Decoder,

	// Used for decoders that don't have timestamps in the stream.
	zero: Option<tokio::time::Instant>,
}

impl DecoderFramed {
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
			"fmp4" | "cmaf" => Box::new(Fmp4::new(broadcast)).into(),
			"aac" => Aac::new(broadcast).into(),
			_ => return None,
		};

		Some(Self { decoder, zero: None })
	}

	/// Explicitly initialize the decoder with a given buffer.
	///
	/// Depending on the format, this may use a different encoding than `decode`.
	///
	/// The buffer will be fully consumed, or an error will be returned.
	pub fn initialize<T: Buf + AsRef<[u8]>>(&mut self, buf: &mut T) -> anyhow::Result<()> {
		let mut pts = || {
			self.zero = self.zero.or_else(|| Some(tokio::time::Instant::now()));
			hang::Timestamp::from_micros(self.zero.unwrap().elapsed().as_micros() as u64)
		};

		match &mut self.decoder {
			Decoder::Avc3(decoder) => decoder.decode_framed(buf, pts()?)?,
			Decoder::Fmp4(decoder) => decoder.decode(buf)?,
			Decoder::Aac(decoder) => decoder.initialize(buf)?,
		}

		anyhow::ensure!(!buf.has_remaining(), "buffer was not fully consumed");

		Ok(())
	}

	/// Decode a frame from the given buffer.
	///
	/// A timestamp can be provided, otherwise wall clock time will be used.
	/// NOTE: Some formats do not need the timestamp and can ignore it.
	///
	/// The buffer will be fully consumed, or an error will be returned.
	pub fn decode<T: Buf + AsRef<[u8]>>(&mut self, buf: &mut T, pts: Option<hang::Timestamp>) -> anyhow::Result<()> {
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
			Decoder::Avc3(decoder) => decoder.decode_framed(buf, pts()?)?,
			Decoder::Fmp4(decoder) => decoder.decode(buf)?,
			Decoder::Aac(decoder) => decoder.decode(buf, pts()?)?,
		}

		anyhow::ensure!(!buf.has_remaining(), "buffer was not fully consumed");

		Ok(())
	}
}
