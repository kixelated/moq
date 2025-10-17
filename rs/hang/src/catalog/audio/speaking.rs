use serde::{Deserialize, Serialize};

/// Speaking indicator track metadata
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Speaking {
	/// The MoQ track information
	pub track: moq_lite::Track,
}
