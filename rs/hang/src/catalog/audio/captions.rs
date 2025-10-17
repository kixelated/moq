use serde::{Deserialize, Serialize};

/// Captions track metadata
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Captions {
	/// The MoQ track information
	pub track: moq_lite::Track,
}
