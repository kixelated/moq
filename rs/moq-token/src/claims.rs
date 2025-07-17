use serde::{Deserialize, Serialize};
use serde_with::{serde_as, TimestampSeconds};

fn is_false(value: &bool) -> bool {
	!value
}

#[serde_as]
#[derive(Debug, Serialize, Deserialize, Default)]
#[serde_with::skip_serializing_none]
#[serde(default)]
pub struct Claims {
	/// The root for the publish/subscribe options below.
	/// It's mostly for compression and is optional, defaulting to the empty string.
	#[serde(default, rename = "root", skip_serializing_if = "String::is_empty")]
	pub root: String,

	/// If specified, the user can publish any matching broadcasts.
	/// If not specified, the user will not publish any broadcasts.
	#[serde(rename = "pub")]
	pub publish: Option<String>,

	/// If true, then this client is considered a cluster node.
	/// Both the client and server will only announce broadcasts from non-cluster clients.
	/// This avoids convoluted routing, as only the primary origin will announce.
	#[serde(default, rename = "cluster", skip_serializing_if = "is_false")]
	pub cluster: bool,

	/// If specified, the user can subscribe to any matching broadcasts.
	/// If not specified, the user will not receive announcements and cannot subscribe to any broadcasts.
	#[serde(rename = "sub")]
	pub subscribe: Option<String>,

	/// The expiration time of the token as a unix timestamp.
	#[serde(rename = "exp")]
	#[serde_as(as = "Option<TimestampSeconds<i64>>")]
	pub expires: Option<std::time::SystemTime>,

	/// The issued time of the token as a unix timestamp.
	#[serde(rename = "iat")]
	#[serde_as(as = "Option<TimestampSeconds<i64>>")]
	pub issued: Option<std::time::SystemTime>,
}

impl Claims {
	pub fn validate(&self) -> anyhow::Result<()> {
		if self.publish.is_none() && self.subscribe.is_none() {
			anyhow::bail!("no publish or subscribe allowed; token is useless");
		}

		Ok(())
	}
}
