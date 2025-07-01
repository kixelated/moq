use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::model::Position;

/// Live location information for spatial audio positioning.
///
/// This struct describes the spatial position of a broadcaster or viewer
/// for implementing spatial audio features like panning and 3D positioning.
///
/// It also contains a mechanism for peers to request position updates.
/// It's up to the broadcaster to fetch the catalog of other peers, detect if their handle is present, and subscribe to those updates.
#[serde_with::serde_as]
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(default, rename_all = "camelCase")]
#[serde_with::skip_serializing_none]
pub struct Location {
	/// Our initial location.
	///
	/// This is the location that we start with. The range is -1 to 1 with (0,0) being the center.
	pub initial: Option<Position>,

	/// An optional track that contains live location updates.
	pub updates: Option<moq_lite::Track>,

	/// If present, this broadcaster is requesting that other peers update their position via the handle.
	#[serde(default, skip_serializing_if = "HashMap::is_empty")]
	pub peers: HashMap<u32, moq_lite::Track>,

	/// If present, viewers can drag this location via this handle
	pub handle: Option<u32>,
}
