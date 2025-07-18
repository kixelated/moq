use std::fmt::{self, Display};

/// A broadcast path that provides safe prefix matching operations.
///
/// This type wraps a String but provides path-aware operations that respect
/// delimiter boundaries, preventing issues like "foo" matching "foobar".
#[derive(Clone, Debug, PartialEq, Eq, Hash, Default)]
pub struct Path(String);

impl Path {
	/// Create a new Path from a string.
	pub fn new(s: impl Into<String>) -> Self {
		Self(s.into())
	}

	/// Check if this path has the given prefix, respecting path boundaries.
	///
	/// Unlike String::starts_with, this ensures that "foo" does not match "foobar".
	/// The prefix must either:
	/// - Be exactly equal to this path
	/// - Be followed by a '/' delimiter
	/// - Be empty (matches everything)
	///
	/// # Examples
	/// ```
	/// use moq_lite::Path;
	///
	/// let path = Path::new("foo/bar");
	/// assert!(path.has_prefix(&Path::new("foo")));
	/// assert!(path.has_prefix(&Path::new("foo/")));
	/// assert!(!path.has_prefix(&Path::new("fo")));
	///
	/// let path = Path::new("foobar");
	/// assert!(!path.has_prefix(&Path::new("foo")));
	/// ```
	pub fn has_prefix(&self, prefix: &Path) -> bool {
		if prefix.0.is_empty() {
			return true;
		}

		if !self.0.starts_with(&prefix.0) {
			return false;
		}

		// Check if the prefix is the exact match
		if self.0.len() == prefix.0.len() {
			return true;
		}

		// If the prefix ends with '/', it's already a proper boundary
		if prefix.0.ends_with('/') {
			return true;
		}

		// Otherwise, ensure the character after the prefix is a delimiter
		self.0.chars().nth(prefix.0.len()) == Some('/')
	}

	/// Strip the given prefix from this path, returning the suffix.
	///
	/// Returns None if the prefix doesn't match according to has_prefix rules.
	///
	/// # Examples
	/// ```
	/// use moq_lite::Path;
	///
	/// let path = Path::new("foo/bar/baz");
	/// let suffix = path.strip_prefix(&Path::new("foo")).unwrap();
	/// assert_eq!(suffix.as_str(), "/bar/baz");
	///
	/// let suffix = path.strip_prefix(&Path::new("foo/")).unwrap();
	/// assert_eq!(suffix.as_str(), "bar/baz");
	/// ```
	pub fn strip_prefix(&self, prefix: &Path) -> Option<Path> {
		if !self.has_prefix(prefix) {
			return None;
		}

		let suffix = &self.0[prefix.0.len()..];
		Some(Path(suffix.to_string()))
	}

	/// Get the path as a string slice.
	pub fn as_str(&self) -> &str {
		&self.0
	}

	/// Check if the path is empty.
	pub fn is_empty(&self) -> bool {
		self.0.is_empty()
	}

	/// Get the length of the path in bytes.
	pub fn len(&self) -> usize {
		self.0.len()
	}

	/// Join this path with another path component.
	///
	/// # Examples
	/// ```
	/// use moq_lite::Path;
	///
	/// let base = Path::new("foo");
	/// let joined = base.join("bar");
	/// assert_eq!(joined.as_str(), "foo/bar");
	///
	/// let base = Path::new("foo/");
	/// let joined = base.join("bar");
	/// assert_eq!(joined.as_str(), "foo/bar");
	/// ```
	pub fn join(&self, component: &str) -> Path {
		if self.0.is_empty() {
			Path::new(component)
		} else if self.0.ends_with('/') {
			Path::new(format!("{}{}", self.0, component))
		} else {
			Path::new(format!("{}/{}", self.0, component))
		}
	}
}

impl Display for Path {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		write!(f, "{}", self.0)
	}
}

impl AsRef<str> for Path {
	fn as_ref(&self) -> &str {
		&self.0
	}
}

impl From<String> for Path {
	fn from(s: String) -> Self {
		Self::new(s)
	}
}

impl From<&str> for Path {
	fn from(s: &str) -> Self {
		Self::new(s)
	}
}

impl From<&String> for Path {
	fn from(s: &String) -> Self {
		Self::new(s)
	}
}

impl From<&Path> for Path {
	fn from(p: &Path) -> Self {
		p.clone()
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_has_prefix() {
		let path = Path::new("foo/bar/baz");

		// Valid prefixes
		assert!(path.has_prefix(&Path::new("")));
		assert!(path.has_prefix(&Path::new("foo")));
		assert!(path.has_prefix(&Path::new("foo/")));
		assert!(path.has_prefix(&Path::new("foo/bar")));
		assert!(path.has_prefix(&Path::new("foo/bar/")));
		assert!(path.has_prefix(&Path::new("foo/bar/baz")));

		// Invalid prefixes - should not match partial components
		assert!(!path.has_prefix(&Path::new("f")));
		assert!(!path.has_prefix(&Path::new("fo")));
		assert!(!path.has_prefix(&Path::new("foo/b")));
		assert!(!path.has_prefix(&Path::new("foo/ba")));
		assert!(!path.has_prefix(&Path::new("foo/bar/ba")));

		// Edge case: "foobar" should not match "foo"
		let path = Path::new("foobar");
		assert!(!path.has_prefix(&Path::new("foo")));
		assert!(path.has_prefix(&Path::new("foobar")));
	}

	#[test]
	fn test_strip_prefix() {
		let path = Path::new("foo/bar/baz");

		assert_eq!(path.strip_prefix(&Path::new("")).unwrap().as_str(), "foo/bar/baz");
		assert_eq!(path.strip_prefix(&Path::new("foo")).unwrap().as_str(), "/bar/baz");
		assert_eq!(path.strip_prefix(&Path::new("foo/")).unwrap().as_str(), "bar/baz");
		assert_eq!(path.strip_prefix(&Path::new("foo/bar")).unwrap().as_str(), "/baz");
		assert_eq!(path.strip_prefix(&Path::new("foo/bar/")).unwrap().as_str(), "baz");
		assert_eq!(path.strip_prefix(&Path::new("foo/bar/baz")).unwrap().as_str(), "");

		// Should fail for invalid prefixes
		assert!(path.strip_prefix(&Path::new("fo")).is_none());
		assert!(path.strip_prefix(&Path::new("bar")).is_none());
	}

	#[test]
	fn test_join() {
		assert_eq!(Path::new("foo").join("bar").as_str(), "foo/bar");
		assert_eq!(Path::new("foo/").join("bar").as_str(), "foo/bar");
		assert_eq!(Path::new("").join("bar").as_str(), "bar");
		assert_eq!(Path::new("foo/bar").join("baz").as_str(), "foo/bar/baz");
	}

	#[test]
	fn test_empty() {
		let empty = Path::new("");
		assert!(empty.is_empty());
		assert_eq!(empty.len(), 0);

		let non_empty = Path::new("foo");
		assert!(!non_empty.is_empty());
		assert_eq!(non_empty.len(), 3);
	}

	#[test]
	fn test_from_conversions() {
		let path1 = Path::from("foo/bar");
		let path2 = Path::from(String::from("foo/bar"));
		let s = String::from("foo/bar");
		let path3 = Path::from(&s);

		assert_eq!(path1.as_str(), "foo/bar");
		assert_eq!(path2.as_str(), "foo/bar");
		assert_eq!(path3.as_str(), "foo/bar");
	}
}
