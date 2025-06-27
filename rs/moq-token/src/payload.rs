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
	/// The URL path that this token is valid for, minus the starting `/`.
	///
	/// This path is the root for all other publish/subscribe paths below.
	/// If the combined path ends with a `/`, then it's treated as a prefix.
	/// If the combined path does not end with a `/`, then it's treated as a specific broadcast.
	#[serde(rename = "path")]
	pub path: String,

	/// If specified, the user can publish any matching broadcasts.
	/// If not specified, the user will not publish any broadcasts.
	///
	/// If the full path does not end with `/`, then the user will publish the specific broadcast.
	/// They will need to announce it of course.
	#[serde(rename = "pub")]
	pub publish: Option<String>,

	/// If true, then any broadcasts published by this user should be considered secondary.
	/// This is primarily used for gossiping broadcasts between cluster nodes.
	/// They will only gossip primary broadcasts, and use each other as secondaries.
	#[serde(default, rename = "pub?", skip_serializing_if = "is_false")]
	pub publish_secondary: bool,

	/// If specified, the user can subscribe to any matching broadcasts.
	/// If not specified, the user will not receive announcements and cannot subscribe to any broadcasts.
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

impl Payload {
	pub fn validate(&self) -> anyhow::Result<()> {
		if self.publish.is_none() && self.subscribe.is_none() {
			anyhow::bail!("no publish or subscribe paths specified; token is useless");
		}

		if !self.path.is_empty() && !self.path.ends_with("/") {
			// If the path doesn't end with /, then we need to make sure the other paths are empty or start with /
			if let Some(publish) = &self.publish {
				if !publish.is_empty() && !publish.starts_with("/") {
					anyhow::bail!("path is not a prefix, so publish can't be relative");
				}
			}

			if let Some(subscribe) = &self.subscribe {
				if !subscribe.is_empty() && !subscribe.starts_with("/") {
					anyhow::bail!("path is not a prefix, so subscribe can't be relative");
				}
			}
		}

		if self.publish.is_none() && self.publish_secondary {
			anyhow::bail!("publish_secondary requires publish to be specified");
		}

		if self.subscribe.is_none() && self.subscribe_primary {
			anyhow::bail!("subscribe_primary requires subscribe to be specified");
		}

		Ok(())
	}
}
