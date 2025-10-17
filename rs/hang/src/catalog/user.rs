use serde::{Deserialize, Serialize};

/// User metadata in the catalog
#[serde_with::skip_serializing_none]
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct User {
	pub id: Option<String>,
	pub name: Option<String>,
	pub avatar: Option<String>, // TODO allow using a track instead of a URL?
	pub color: Option<String>,
}
