use serde::{Deserialize, Serialize};

/// Detection track metadata
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
	/// The MoQ track information
	pub track: moq_lite::Track,
}

/// A detected object in the video
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DetectionObject {
	pub label: String,
	pub score: f64, // 0.0 to 1.0
	pub x: f64,     // 0.0 to 1.0
	pub y: f64,     // 0.0 to 1.0
	pub w: f64,     // 0.0 to 1.0
	pub h: f64,     // 0.0 to 1.0
}

/// A list of detected objects
pub type DetectionObjects = Vec<DetectionObject>;
