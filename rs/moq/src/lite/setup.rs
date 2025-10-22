use crate::{coding::*, lite::Message};

/// Sent by the client to setup the session.
#[derive(Debug, Clone)]
pub struct ClientSetup {
	/// The list of supported versions in preferred order.
	pub versions: Versions,

	/// Extensions.
	pub parameters: Parameters,
}

impl Message for ClientSetup {
	/// Decode a client setup message.
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let versions = Versions::decode(r)?;
		let parameters = Parameters::decode(r)?;

		Ok(Self { versions, parameters })
	}

	/// Encode a client setup message.
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.versions.encode(w);
		self.parameters.encode(w);
	}
}

/// Sent by the server in response to a client setup.
#[derive(Debug, Clone)]
pub struct ServerSetup {
	/// The list of supported versions in preferred order.
	pub version: Version,

	/// Supported extensions.
	pub parameters: Parameters,
}

impl Message for ServerSetup {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.version.encode(w);
		self.parameters.encode(w);
	}

	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let version = Version::decode(r)?;
		let parameters = Parameters::decode(r)?;

		Ok(Self { version, parameters })
	}
}
