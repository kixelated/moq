use serde::{Deserialize, Serialize};

/// Preview information about a broadcast
#[serde_with::skip_serializing_none]
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
	pub name: Option<String>,   // name
	pub avatar: Option<String>, // avatar

	pub audio: Option<bool>,  // audio enabled
	pub video: Option<bool>,  // video enabled
	pub screen: Option<bool>, // screen sharing

	pub typing: Option<bool>, // actively typing
	pub chat: Option<bool>,   // chatted recently
}
