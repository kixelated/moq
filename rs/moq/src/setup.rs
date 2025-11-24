use bytes::Bytes;

use crate::coding::{Decode, DecodeError, Encode, Sizer, Version, Versions};
use num_enum::{IntoPrimitive, TryFromPrimitive};

#[derive(Debug, Clone, Copy, PartialEq, Eq, TryFromPrimitive, IntoPrimitive)]
#[repr(u64)]
pub enum ClientKind {
	// This varint ID follow by the varint size.
	Lite = 0x0,
	// This varint ID followed by a varint size
	// Valid until draft 10
	Ietf7 = 0x40,
	// This varint ID followed by a u16 size
	// Valid until draft 15
	Ietf14 = 0x20,
}

impl<V> Encode<V> for ClientKind {
	fn encode<W: bytes::BufMut>(&self, w: &mut W, version: V) {
		u64::from(*self).encode(w, version);
	}
}

impl<V> Decode<V> for ClientKind {
	fn decode<R: bytes::Buf>(r: &mut R, version: V) -> Result<Self, DecodeError> {
		Self::try_from(u64::decode(r, version)?).map_err(|_| DecodeError::InvalidValue)
	}
}

impl ClientKind {
	pub fn reply(self) -> ServerKind {
		match self {
			Self::Lite => ServerKind::Lite,
			Self::Ietf7 => ServerKind::Ietf7,
			Self::Ietf14 => ServerKind::Ietf14,
		}
	}
}

/// A version-agnostic setup message sent by the client.
#[derive(Debug, Clone)]
pub struct Client {
	/// The first byte of the setup message.
	pub kind: ClientKind,

	/// The list of supported versions in preferred order.
	pub versions: Versions,

	/// Parameters, unparsed because the IETF draft changed the encoding.
	pub parameters: Bytes,
}

impl<V: Clone> Decode<V> for Client {
	/// Decode a client setup message.
	fn decode<R: bytes::Buf>(r: &mut R, v: V) -> Result<Self, DecodeError> {
		let kind = ClientKind::decode(r, v.clone())?;
		let size = match kind {
			ClientKind::Lite | ClientKind::Ietf7 => u64::decode(r, v.clone())? as usize,
			ClientKind::Ietf14 => u16::decode(r, v.clone())? as usize,
		};

		if r.remaining() < size {
			return Err(DecodeError::Short);
		}

		let mut msg = r.copy_to_bytes(size);
		let versions = Versions::decode(&mut msg, v)?;

		Ok(Self {
			kind,
			versions,
			parameters: msg,
		})
	}
}

impl<V: Clone> Encode<V> for Client {
	/// Encode a client setup message.
	fn encode<W: bytes::BufMut>(&self, w: &mut W, v: V) {
		self.kind.encode(w, v.clone());

		let mut sizer = Sizer::default();
		self.versions.encode(&mut sizer, v.clone());
		let size = sizer.size + self.parameters.len();

		match self.kind {
			ClientKind::Lite | ClientKind::Ietf7 => (size as u64).encode(w, v.clone()),
			ClientKind::Ietf14 => (size as u16).encode(w, v.clone()),
		}

		self.versions.encode(w, v);
		w.put_slice(&self.parameters);
	}
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, TryFromPrimitive, IntoPrimitive)]
#[repr(u64)]
pub enum ServerKind {
	Lite = 0x0, // NOTE: Not actually encoded
	Ietf7 = 0x41,
	Ietf14 = 0x21,
}

impl Encode<()> for ServerKind {
	fn encode<W: bytes::BufMut>(&self, w: &mut W, version: ()) {
		u64::from(*self).encode(w, version);
	}
}

impl Decode<()> for ServerKind {
	fn decode<R: bytes::Buf>(r: &mut R, version: ()) -> Result<Self, DecodeError> {
		Self::try_from(u64::decode(r, version)?).map_err(|_| DecodeError::InvalidValue)
	}
}

/// Sent by the server in response to a client setup.
#[derive(Debug, Clone)]
pub struct Server {
	/// The list of supported versions in preferred order.
	pub version: Version,

	/// Supported extensions.
	pub parameters: Bytes,
}

impl Encode<ServerKind> for Server {
	fn encode<W: bytes::BufMut>(&self, w: &mut W, v: ServerKind) {
		if v != ServerKind::Lite {
			v.encode(w, ());
		}

		let mut sizer = Sizer::default();
		self.version.encode(&mut sizer, v);
		let size = sizer.size + self.parameters.len();

		match v {
			ServerKind::Lite | ServerKind::Ietf7 => (size as u64).encode(w, v),
			ServerKind::Ietf14 => (size as u16).encode(w, v),
		}

		self.version.encode(w, v);
		w.put_slice(&self.parameters);
	}
}

impl Decode<ServerKind> for Server {
	fn decode<R: bytes::Buf>(r: &mut R, v: ServerKind) -> Result<Self, DecodeError> {
		if v != ServerKind::Lite {
			let kind = ServerKind::decode(r, ())?;
			if kind != v {
				return Err(DecodeError::InvalidValue);
			}
		}

		let size = match v {
			ServerKind::Lite | ServerKind::Ietf7 => u64::decode(r, v)? as usize,
			ServerKind::Ietf14 => u16::decode(r, v)? as usize,
		};

		if r.remaining() < size {
			return Err(DecodeError::Short);
		}

		let mut msg = r.copy_to_bytes(size);
		let version = Version::decode(&mut msg, v)?;

		Ok(Self {
			version,
			parameters: msg,
		})
	}
}
