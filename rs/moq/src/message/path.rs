use std::fmt::{self, Display};

use crate::coding::{Decode, DecodeError, Encode};

/// A broadcast path that provides safe prefix matching operations.
///
/// This type wraps a String but provides path-aware operations that respect
/// delimiter boundaries, preventing issues like "foo" matching "foobar".
#[derive(Clone, Debug, PartialEq, Eq, Hash, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Path(String);

/// A path prefix used for announcement requests and authentication.
///
/// This type represents a prefix that can be used to match against full paths
/// for authorization and announcement filtering purposes.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Prefix(String);

/// A path suffix used for network compression and concatenation.
///
/// This type represents a suffix that can be concatenated with a prefix
/// to form a complete path. It's designed for efficient network transmission
/// where the prefix is known context.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Suffix(String);

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
	/// use moq_lite::{Path, PathPrefix};
	///
	/// let path = Path::new("foo/bar");
	/// assert!(path.has_prefix(&PathPrefix::new("foo")));
	/// assert!(path.has_prefix(&PathPrefix::new("foo/")));
	/// assert!(!path.has_prefix(&PathPrefix::new("fo")));
	///
	/// let path = Path::new("foobar");
	/// assert!(!path.has_prefix(&PathPrefix::new("foo")));
	/// ```
	pub fn has_prefix(&self, prefix: &Prefix) -> bool {
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
	/// use moq_lite::{Path, PathPrefix};
	///
	/// let path = Path::new("foo/bar/baz");
	/// let suffix = path.strip_prefix(&PathPrefix::new("foo")).unwrap();
	/// assert_eq!(suffix.as_str(), "/bar/baz");
	///
	/// let suffix = path.strip_prefix(&PathPrefix::new("foo/")).unwrap();
	/// assert_eq!(suffix.as_str(), "bar/baz");
	/// ```
	pub fn strip_prefix(&self, prefix: &Prefix) -> Option<Suffix> {
		if !self.has_prefix(prefix) {
			return None;
		}

		let suffix = &self.0[prefix.0.len()..];
		Some(Suffix(suffix.to_string()))
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

impl Prefix {
	/// Create a new PathPrefix from a string.
	pub fn new(s: impl Into<String>) -> Self {
		Self(s.into())
	}

	/// Join this prefix with a suffix to create a complete path.
	///
	/// # Examples
	/// ```
	/// use moq_lite::{PathPrefix, PathSuffix};
	///
	/// let prefix = PathPrefix::new("foo");
	/// let suffix = PathSuffix::new("bar/baz");
	/// let path = prefix.join(&suffix);
	/// assert_eq!(path.as_str(), "foo/bar/baz");
	///
	/// let prefix = PathPrefix::new("foo/");
	/// let suffix = PathSuffix::new("bar/baz");
	/// let path = prefix.join(&suffix);
	/// assert_eq!(path.as_str(), "foo/bar/baz");
	/// ```
	pub fn join(&self, suffix: &Suffix) -> Path {
		if self.0.is_empty() {
			Path::new(&suffix.0)
		} else if self.0.ends_with('/') {
			Path::new(format!("{}{}", self.0, suffix.0))
		} else if suffix.0.starts_with('/') {
			Path::new(format!("{}{}", self.0, suffix.0))
		} else {
			Path::new(format!("{}/{}", self.0, suffix.0))
		}
	}

	/// Join this prefix with another prefix.
	///
	/// # Examples
	/// ```
	/// use moq_lite::{PathPrefix, PathPrefix};
	///
	/// let prefix = PathPrefix::new("foo");
	/// let joined = prefix.join_prefix(&PathPrefix::new("bar"));
	/// assert_eq!(joined.as_str(), "foo/bar");
	///
	/// let prefix = PathPrefix::new("foo/");
	/// let joined = prefix.join_prefix(&PathPrefix::new("bar"));
	/// assert_eq!(joined.as_str(), "foo/bar");
	/// ```
	pub fn join_prefix(&self, prefix: &Prefix) -> Prefix {
		if prefix.0.is_empty() {
			self.clone()
		} else if self.0.is_empty() {
			prefix.clone()
		} else if self.0.ends_with('/') {
			Prefix::new(format!("{}{}", self.0, prefix.0))
		} else if prefix.0.starts_with('/') {
			Prefix::new(format!("{}{}", self.0, prefix.0))
		} else {
			Prefix::new(format!("{}/{}", self.0, prefix.0))
		}
	}

	pub fn has_prefix(&self, prefix: &Prefix) -> bool {
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

	/// Get the prefix as a string slice.
	pub fn as_str(&self) -> &str {
		&self.0
	}

	/// Check if the prefix is empty.
	pub fn is_empty(&self) -> bool {
		self.0.is_empty()
	}

	/// Get the length of the prefix in bytes.
	pub fn len(&self) -> usize {
		self.0.len()
	}
}

impl Suffix {
	/// Create a new PathSuffix from a string.
	pub fn new(s: impl Into<String>) -> Self {
		Self(s.into())
	}

	/// Get the suffix as a string slice.
	pub fn as_str(&self) -> &str {
		&self.0
	}

	/// Check if the suffix is empty.
	pub fn is_empty(&self) -> bool {
		self.0.is_empty()
	}

	/// Get the length of the suffix in bytes.
	pub fn len(&self) -> usize {
		self.0.len()
	}
}

impl Display for Path {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		write!(f, "{}", self.0)
	}
}

impl Display for Prefix {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		write!(f, "{}", self.0)
	}
}

impl Display for Suffix {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		write!(f, "{}", self.0)
	}
}

impl AsRef<str> for Path {
	fn as_ref(&self) -> &str {
		&self.0
	}
}

impl AsRef<str> for Prefix {
	fn as_ref(&self) -> &str {
		&self.0
	}
}

impl AsRef<str> for Suffix {
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

impl From<String> for Prefix {
	fn from(s: String) -> Self {
		Self::new(s)
	}
}

impl From<&str> for Prefix {
	fn from(s: &str) -> Self {
		Self::new(s)
	}
}

impl From<&String> for Prefix {
	fn from(s: &String) -> Self {
		Self::new(s)
	}
}

impl From<&Prefix> for Prefix {
	fn from(p: &Prefix) -> Self {
		p.clone()
	}
}

impl From<Path> for Prefix {
	fn from(p: Path) -> Self {
		Self::new(p.0)
	}
}

impl From<&Path> for Prefix {
	fn from(p: &Path) -> Self {
		Self::new(&p.0)
	}
}

impl From<String> for Suffix {
	fn from(s: String) -> Self {
		Self::new(s)
	}
}

impl From<&str> for Suffix {
	fn from(s: &str) -> Self {
		Self::new(s)
	}
}

impl From<&String> for Suffix {
	fn from(s: &String) -> Self {
		Self::new(s)
	}
}

impl From<&Suffix> for Suffix {
	fn from(p: &Suffix) -> Self {
		p.clone()
	}
}

impl Decode for Prefix {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let prefix = String::decode(r)?;
		Ok(Self::new(prefix))
	}
}

impl Encode for Prefix {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.0.encode(w)
	}
}

impl Decode for Suffix {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let suffix = String::decode(r)?;
		Ok(Self::new(suffix))
	}
}

impl Encode for Suffix {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.0.encode(w)
	}
}

impl Decode for Path {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let path = String::decode(r)?;
		Ok(Self::new(path))
	}
}

impl Encode for Path {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.0.encode(w)
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_has_prefix() {
		let path = Path::new("foo/bar/baz");

		// Valid prefixes
		assert!(path.has_prefix(&Prefix::new("")));
		assert!(path.has_prefix(&Prefix::new("foo")));
		assert!(path.has_prefix(&Prefix::new("foo/")));
		assert!(path.has_prefix(&Prefix::new("foo/bar")));
		assert!(path.has_prefix(&Prefix::new("foo/bar/")));
		assert!(path.has_prefix(&Prefix::new("foo/bar/baz")));

		// Invalid prefixes - should not match partial components
		assert!(!path.has_prefix(&Prefix::new("f")));
		assert!(!path.has_prefix(&Prefix::new("fo")));
		assert!(!path.has_prefix(&Prefix::new("foo/b")));
		assert!(!path.has_prefix(&Prefix::new("foo/ba")));
		assert!(!path.has_prefix(&Prefix::new("foo/bar/ba")));

		// Edge case: "foobar" should not match "foo"
		let path = Path::new("foobar");
		assert!(!path.has_prefix(&Prefix::new("foo")));
		assert!(path.has_prefix(&Prefix::new("foobar")));
	}

	#[test]
	fn test_strip_prefix() {
		let path = Path::new("foo/bar/baz");

		assert_eq!(path.strip_prefix(&Prefix::new("")).unwrap().as_str(), "foo/bar/baz");
		assert_eq!(path.strip_prefix(&Prefix::new("foo")).unwrap().as_str(), "/bar/baz");
		assert_eq!(path.strip_prefix(&Prefix::new("foo/")).unwrap().as_str(), "bar/baz");
		assert_eq!(path.strip_prefix(&Prefix::new("foo/bar")).unwrap().as_str(), "/baz");
		assert_eq!(path.strip_prefix(&Prefix::new("foo/bar/")).unwrap().as_str(), "baz");
		assert_eq!(path.strip_prefix(&Prefix::new("foo/bar/baz")).unwrap().as_str(), "");

		// Should fail for invalid prefixes
		assert!(path.strip_prefix(&Prefix::new("fo")).is_none());
		assert!(path.strip_prefix(&Prefix::new("bar")).is_none());
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

	#[test]
	fn test_path_prefix_join() {
		let prefix = Prefix::new("foo");
		let suffix = Suffix::new("bar/baz");
		let path = prefix.join(&suffix);
		assert_eq!(path.as_str(), "foo/bar/baz");

		let prefix = Prefix::new("foo/");
		let suffix = Suffix::new("bar/baz");
		let path = prefix.join(&suffix);
		assert_eq!(path.as_str(), "foo/bar/baz");

		let prefix = Prefix::new("foo");
		let suffix = Suffix::new("/bar/baz");
		let path = prefix.join(&suffix);
		assert_eq!(path.as_str(), "foo/bar/baz");

		let prefix = Prefix::new("");
		let suffix = Suffix::new("bar/baz");
		let path = prefix.join(&suffix);
		assert_eq!(path.as_str(), "bar/baz");
	}

	#[test]
	fn test_path_prefix_conversions() {
		let prefix1 = Prefix::from("foo/bar");
		let prefix2 = Prefix::from(String::from("foo/bar"));
		let s = String::from("foo/bar");
		let prefix3 = Prefix::from(&s);

		assert_eq!(prefix1.as_str(), "foo/bar");
		assert_eq!(prefix2.as_str(), "foo/bar");
		assert_eq!(prefix3.as_str(), "foo/bar");
	}

	#[test]
	fn test_path_suffix_conversions() {
		let suffix1 = Suffix::from("foo/bar");
		let suffix2 = Suffix::from(String::from("foo/bar"));
		let s = String::from("foo/bar");
		let suffix3 = Suffix::from(&s);

		assert_eq!(suffix1.as_str(), "foo/bar");
		assert_eq!(suffix2.as_str(), "foo/bar");
		assert_eq!(suffix3.as_str(), "foo/bar");
	}

	#[test]
	fn test_path_types_basic_operations() {
		let prefix = Prefix::new("foo/bar");
		assert_eq!(prefix.as_str(), "foo/bar");
		assert!(!prefix.is_empty());
		assert_eq!(prefix.len(), 7);

		let suffix = Suffix::new("baz/qux");
		assert_eq!(suffix.as_str(), "baz/qux");
		assert!(!suffix.is_empty());
		assert_eq!(suffix.len(), 7);

		let empty_prefix = Prefix::new("");
		assert!(empty_prefix.is_empty());
		assert_eq!(empty_prefix.len(), 0);

		let empty_suffix = Suffix::new("");
		assert!(empty_suffix.is_empty());
		assert_eq!(empty_suffix.len(), 0);
	}

	#[test]
	fn test_prefix_has_prefix() {
		// Test empty prefix (should match everything)
		let prefix = Prefix::new("foo/bar");
		assert!(prefix.has_prefix(&Prefix::new("")));

		// Test exact matches
		let prefix = Prefix::new("foo/bar");
		assert!(prefix.has_prefix(&Prefix::new("foo/bar")));
		
		// Test valid prefixes
		assert!(prefix.has_prefix(&Prefix::new("foo")));
		assert!(prefix.has_prefix(&Prefix::new("foo/")));

		// Test invalid prefixes - partial matches should fail
		assert!(!prefix.has_prefix(&Prefix::new("f")));
		assert!(!prefix.has_prefix(&Prefix::new("fo")));
		assert!(!prefix.has_prefix(&Prefix::new("foo/b")));
		assert!(!prefix.has_prefix(&Prefix::new("foo/ba")));

		// Test edge cases
		let prefix = Prefix::new("foobar");
		assert!(!prefix.has_prefix(&Prefix::new("foo")));
		assert!(prefix.has_prefix(&Prefix::new("foobar")));

		// Test trailing slash handling
		let prefix = Prefix::new("foo/bar/");
		assert!(prefix.has_prefix(&Prefix::new("foo")));
		assert!(prefix.has_prefix(&Prefix::new("foo/")));
		assert!(prefix.has_prefix(&Prefix::new("foo/bar")));
		assert!(prefix.has_prefix(&Prefix::new("foo/bar/")));

		// Test single component
		let prefix = Prefix::new("foo");
		assert!(prefix.has_prefix(&Prefix::new("")));
		assert!(prefix.has_prefix(&Prefix::new("foo")));
		assert!(!prefix.has_prefix(&Prefix::new("foo/")));
		assert!(!prefix.has_prefix(&Prefix::new("f")));

		// Test empty prefix
		let prefix = Prefix::new("");
		assert!(prefix.has_prefix(&Prefix::new("")));
		assert!(!prefix.has_prefix(&Prefix::new("foo")));
	}

	#[test]
	fn test_prefix_join_prefix() {
		// Basic joining
		let prefix1 = Prefix::new("foo");
		let prefix2 = Prefix::new("bar");
		assert_eq!(prefix1.join_prefix(&prefix2).as_str(), "foo/bar");

		// Trailing slash on first prefix
		let prefix1 = Prefix::new("foo/");
		let prefix2 = Prefix::new("bar");
		assert_eq!(prefix1.join_prefix(&prefix2).as_str(), "foo/bar");

		// Trailing slash on second prefix
		let prefix1 = Prefix::new("foo");
		let prefix2 = Prefix::new("bar/");
		assert_eq!(prefix1.join_prefix(&prefix2).as_str(), "foo/bar/");

		// Both have trailing slashes
		let prefix1 = Prefix::new("foo/");
		let prefix2 = Prefix::new("bar/");
		assert_eq!(prefix1.join_prefix(&prefix2).as_str(), "foo/bar/");

		// Empty second prefix
		let prefix1 = Prefix::new("foo");
		let prefix2 = Prefix::new("");
		assert_eq!(prefix1.join_prefix(&prefix2).as_str(), "foo");

		// Empty first prefix
		let prefix1 = Prefix::new("");
		let prefix2 = Prefix::new("bar");
		assert_eq!(prefix1.join_prefix(&prefix2).as_str(), "bar");

		// Both empty
		let prefix1 = Prefix::new("");
		let prefix2 = Prefix::new("");
		assert_eq!(prefix1.join_prefix(&prefix2).as_str(), "");

		// Complex paths
		let prefix1 = Prefix::new("foo/bar");
		let prefix2 = Prefix::new("baz/qux");
		assert_eq!(prefix1.join_prefix(&prefix2).as_str(), "foo/bar/baz/qux");

		// Complex paths with trailing slashes
		let prefix1 = Prefix::new("foo/bar/");
		let prefix2 = Prefix::new("baz/qux/");
		assert_eq!(prefix1.join_prefix(&prefix2).as_str(), "foo/bar/baz/qux/");
	}
}
