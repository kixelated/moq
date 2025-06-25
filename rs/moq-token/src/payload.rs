use serde::{Deserialize, Serialize};
use serde_with::{serde_as, TimestampSeconds};

fn is_false(value: &bool) -> bool {
	!value
}

#[serde_as]
#[derive(Debug, Serialize, Deserialize, Default)]
#[serde_with::skip_serializing_none]
#[serde(default)]
pub struct Payload {
	/// The root path. All paths are relative to this path.
	#[serde(rename = "path", skip_serializing_if = "String::is_empty")]
	pub path: String,

	/// If specified, the user can publish any broadcasts matching this path.
	/// If not specified, the user cannot publish any broadcasts.
	/// NOTE: This path is relative to the key path, configured as part of moq-relay.
	#[serde(rename = "pub")]
	pub publish: Option<String>,

	/// If specified, the user will publish this path.
	/// No announcement is needed, and the broadcast is considered active while the connection is active.
	/// This is useful to avoid an RTT and informs all other clients that this user is connected.
	#[serde(rename = "pub!")]
	pub publish_force: Option<String>,

	/// If true, then any broadcasts published by this user should be considered secondary.
	/// This is primarily used for gossiping broadcasts between cluster nodes.
	/// They will only gossip primary broadcasts, and use each other as secondaries.
	#[serde(default, rename = "pub?", skip_serializing_if = "is_false")]
	pub publish_secondary: bool,

	/// If specified, the user can subscribe to any broadcasts matching a prefix.
	/// If not specified, the user cannot subscribe to any broadcasts.
	#[serde(rename = "sub")]
	pub subscribe: Option<String>,

	/// If specified, then this session will only receive primary broadcasts.
	/// This is primarily used for gossiping broadcasts between cluster nodes.
	/// We don't want nodes gossiping themselves as origins if they're just a middle node.
	#[serde(default, rename = "sub?", skip_serializing_if = "is_false")]
	pub subscribe_primary: bool,

	/// The expiration time of the token as a unix timestamp.
	#[serde(rename = "exp")]
	#[serde_as(as = "Option<TimestampSeconds<i64>>")]
	pub expires: Option<std::time::SystemTime>,

	/// The issued time of the token as a unix timestamp.
	#[serde(rename = "iat")]
	#[serde_as(as = "Option<TimestampSeconds<i64>>")]
	pub issued: Option<std::time::SystemTime>,
}
