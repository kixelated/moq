use crate as hang;
use anyhow::Context;
use bytes::{Buf, Bytes};
use moq_lite as moq;

// 4 byte start code.
// Yes, it's one byte longer than the 3 byte start code, but it's easier to convert to MP4.
const START_CODE: Bytes = Bytes::from_static(&[0, 0, 0, 1]);

pub struct Avc3 {
	// The broadcast being produced.
	// This `hang` variant includes a catalog.
	broadcast: hang::BroadcastProducer,

	// The track being produced.
	track: hang::TrackProducer,

	// Whether the track has been initialized.
	initialized: bool,

	// The current frame being built.
	current: Frame,
}

impl Avc3 {
	pub fn new(mut broadcast: hang::BroadcastProducer) -> Self {
		let track = moq::Track {
			name: broadcast.track_name("video"),
			priority: 2,
		};

		let track = track.produce();
		broadcast.insert_track(track.consumer);

		Self {
			broadcast,
			track: track.producer.into(),
			initialized: false,
			current: Default::default(),
		}
	}

	fn init(&mut self, sps: &h264_parser::Sps) -> anyhow::Result<()> {
		let constraint_flags: u8 = ((sps.constraint_set0_flag as u8) << 7)
			| ((sps.constraint_set1_flag as u8) << 6)
			| ((sps.constraint_set2_flag as u8) << 5)
			| ((sps.constraint_set3_flag as u8) << 4)
			| ((sps.constraint_set4_flag as u8) << 3)
			| ((sps.constraint_set5_flag as u8) << 2);

		let track = moq::Track {
			name: self.broadcast.track_name("video"),
			priority: 2,
		};

		let config = hang::catalog::VideoConfig {
			coded_width: Some(sps.width),
			coded_height: Some(sps.height),
			codec: hang::catalog::H264 {
				profile: sps.profile_idc,
				constraints: constraint_flags,
				level: sps.level_idc,
				inline: true,
			}
			.into(),
			description: None,
			// TODO: populate these fields
			framerate: None,
			bitrate: None,
			display_ratio_width: None,
			display_ratio_height: None,
			optimize_for_latency: None,
		};

		tracing::debug!(name = ?track.name, ?config, "starting track");

		let mut catalog = self.broadcast.catalog.lock();
		let video = catalog.insert_video(track.name.clone(), config);
		video.priority = 2;

		self.initialized = true;

		Ok(())
	}

	pub fn initialize<T: Buf + AsRef<[u8]>>(&mut self, buf: &mut T) -> anyhow::Result<()> {
		let mut nals = NalIterator::new(buf);

		while let Some(nal) = nals.next() {
			let nal = nal?;

			let header = nal.get(0).context("NAL unit is too short")?;
			let forbidden_zero_bit = (header >> 7) & 1;
			anyhow::ensure!(forbidden_zero_bit == 0, "forbidden zero bit is not zero");

			let nal_unit_type = header & 0b11111;
			let nal_type = NalType::try_from(nal_unit_type).context("unknown NAL unit type")?;

			match nal_type {
				NalType::Sps => {
					// TODO need to unescape the NAL
					let sps = h264_parser::Sps::parse(&nal)?;
					self.init(&sps)?;
				}
				NalType::IdrSlice
				| NalType::NonIdrSlice
				| NalType::DataPartitionA
				| NalType::DataPartitionB
				| NalType::DataPartitionC => anyhow::bail!("expected SPS before any frames"),
				_ => {}
			}

			// Rather than keeping the original size of the start code, we replace it with a 4 byte start code.
			// It's just marginally easier and potentially more efficient down the line (JS player with MSE).
			self.current.chunks.push(START_CODE.clone());
			self.current.chunks.push(nal);
		}

		Ok(())
	}

	pub fn decode<T: Buf + AsRef<[u8]>>(&mut self, buf: &mut T, pts: hang::Timestamp) -> anyhow::Result<()> {
		let mut nals = NalIterator::new(buf);

		while let Some(nal) = nals.next() {
			let nal = nal?;

			let header = nal.get(0).context("NAL unit is too short")?;
			let forbidden_zero_bit = (header >> 7) & 1;
			anyhow::ensure!(forbidden_zero_bit == 0, "forbidden zero bit is not zero");

			let nal_unit_type = header & 0b11111;
			let nal_type = NalType::try_from(nal_unit_type).context("unknown NAL unit type")?;

			match nal_type {
				// TODO parse the SPS again and reinitialize the track if needed
				NalType::Aud | NalType::Sps | NalType::Pps | NalType::Sei => {
					self.maybe_flush(pts)?;
				}
				NalType::IdrSlice => {
					self.current.contains_idr = true;
					self.current.contains_slice = true;
				}
				NalType::NonIdrSlice | NalType::DataPartitionA | NalType::DataPartitionB | NalType::DataPartitionC => {
					// first_mb_in_slice flag, means this is the first frame of a slice.
					if nal.get(1).context("NAL unit is too short")? & 0x80 != 0 {
						self.maybe_flush(pts)?;
					}

					self.current.contains_slice = true;
				}
				_ => {}
			}

			// Rather than keeping the original size of the start code, we replace it with a 4 byte start code.
			// It's just marginally easier and potentially more efficient down the line (JS player with MSE).
			self.current.chunks.push(START_CODE.clone());
			self.current.chunks.push(nal);
		}

		Ok(())
	}

	fn maybe_flush(&mut self, pts: hang::Timestamp) -> anyhow::Result<()> {
		// If we haven't seen any slices, we shouldn't flush yet.
		if !self.current.contains_slice {
			return Ok(());
		}

		self.track
			.write_chunks(self.current.contains_idr, pts, self.current.chunks.iter().cloned())?;
		self.current.clear();

		Ok(())
	}

	pub fn is_initialized(&self) -> bool {
		self.initialized
	}
}

impl Drop for Avc3 {
	fn drop(&mut self) {
		if self.initialized {
			tracing::debug!(name = ?self.track.info.name, "ending track");
			self.broadcast.catalog.lock().remove_video(&self.track.info.name);
		}
	}
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, num_enum::TryFromPrimitive)]
#[repr(u8)]
pub enum NalType {
	Unspecified = 0,
	NonIdrSlice = 1,
	DataPartitionA = 2,
	DataPartitionB = 3,
	DataPartitionC = 4,
	IdrSlice = 5,
	Sei = 6,
	Sps = 7,
	Pps = 8,
	Aud = 9,
	EndOfSeq = 10,
	EndOfStream = 11,
	Filler = 12,
	SpsExt = 13,
	Prefix = 14,
	SubsetSps = 15,
	DepthParameterSet = 16,
}

struct NalIterator<T: Buf + AsRef<[u8]>> {
	buf: T,
	start: Option<usize>,
}

impl<T: Buf + AsRef<[u8]>> NalIterator<T> {
	pub fn new(buf: T) -> Self {
		Self { buf, start: None }
	}
}

impl<T: Buf + AsRef<[u8]>> Iterator for NalIterator<T> {
	type Item = anyhow::Result<Bytes>;

	fn next(&mut self) -> Option<Self::Item> {
		let start = match self.start {
			Some(start) => start,
			None => match after_start_code(&self.buf.as_ref()).transpose()? {
				Ok(start) => start,
				Err(err) => return Some(Err(err)),
			},
		};

		let (size, new_start) = find_start_code(&self.buf.as_ref()[start..])?;
		self.buf.advance(start);

		let nal = self.buf.copy_to_bytes(size);
		self.start = Some(new_start);
		Some(Ok(nal))
	}
}

// Return the size of the start code at the start of the buffer.
fn after_start_code(b: &[u8]) -> anyhow::Result<Option<usize>> {
	if b.len() < 3 {
		return Ok(None);
	}

	// NOTE: We have to check every byte, so the `find_start_code` optimization doesn't matter.
	anyhow::ensure!(b[0] == 0, "missing Annex B start code");
	anyhow::ensure!(b[1] == 0, "missing Annex B start code");

	match b[2] {
		0 if b.len() < 4 => Ok(None),
		0 if b[3] != 1 => anyhow::bail!("missing Annex B start code"),
		0 => Ok(Some(4)),
		1 => Ok(Some(3)),
		_ => anyhow::bail!("invalid Annex B start code"),
	}
}

// Return the number of bytes until the next start code, and the size of that start code.
fn find_start_code(b: &[u8]) -> Option<(usize, usize)> {
	// Okay this is over-engineered because this was my interview question.
	// We need to find either a 3 byte or 4 byte start code.
	// 3-byte: 0 0 1
	// 4-byte: 0 0 0 1
	//
	// You fail the interview if you call string.split twice or something.
	// You get a pass if you do index += 1 and check the next 3-4 bytes.
	// You get my eternal respect if you check the 3rd byte first.
	// What?
	//
	// If we check the 3rd byte and it's not a 0 or 1, then we immediately index += 3
	// Sometimes we might only skip 1 or 2 bytes, but it's still better than checking every byte.
	//
	// TODO Is this the type of thing that SIMD could further improve?
	// If somebody can figure that out, I'll buy you a beer.

	let mut index = 0;

	while index + 2 < b.len() {
		// ? ? ?
		match b[index + 2] {
			// ? ? 0
			0 if index + 3 < b.len() => match b[index + 1] {
				// ? 0 0 0
				0 => index += 1,
				// ? 0 0 1
				1 => match b[index] {
					// 0 0 0 1
					0 => return Some((index, 4)),
					// x 0 0 1
					_ => return Some((index + 1, 3)),
				},
				// ? 0 0 x
				_ => index += 4,
			},
			// ? ? 0 FIN
			0 => return None,
			// ? ? 1
			1 => match b[index + 1] {
				// ? 0 1
				0 => match b[index] {
					// 0 0 1
					0 => return Some((index, 3)),
					// ? 0 1
					_ => index += 3,
				},
				// ? x 1
				_ => index += 3,
			},
			// ? ? x
			_ => index += 3,
		}
	}

	None
}

#[derive(Default)]
struct Frame {
	chunks: Vec<Bytes>,
	contains_idr: bool,
	contains_slice: bool,
}

impl Frame {
	fn clear(&mut self) {
		self.chunks.clear();
		self.contains_idr = false;
		self.contains_slice = false;
	}
}
