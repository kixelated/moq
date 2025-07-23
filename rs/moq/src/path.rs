use std::borrow::Cow;
use std::fmt::{self, Display};

use crate::coding::{Decode, DecodeError, Encode};

/// A trait alias for types that can be converted to a PathRef.
/// This provides better error messages and documentation.
pub trait IntoPathRef<'a>: Into<PathRef<'a>> {}

impl<'a, T: Into<PathRef<'a>>> IntoPathRef<'a> for T {}

/// A borrowed reference to a path.
///
/// This type is to Path as &str is to String. It provides a way to work with
/// path strings without requiring ownership. Uses Cow to avoid allocations
/// when no normalization is needed, but can normalize internal multiple slashes
/// when required.
#[derive(Debug, PartialEq, Eq, Hash, Clone)]
pub struct PathRef<'a>(Cow<'a, str>);

impl<'a> PathRef<'a> {
	/// Create a new PathRef from a string slice.
	///
	/// Leading and trailing slashes are automatically trimmed.
	/// Multiple consecutive internal slashes are collapsed to single slashes.
	pub fn new(s: &'a str) -> Self {
		let trimmed = s.trim_start_matches('/').trim_end_matches('/');

		// Check if we need to normalize (has multiple consecutive slashes)
		if trimmed.contains("//") {
			// Only allocate if we actually need to normalize
			let normalized = trimmed
				.split('/')
				.filter(|s| !s.is_empty())
				.collect::<Vec<_>>()
				.join("/");
			Self(Cow::Owned(normalized))
		} else {
			// No normalization needed - use borrowed string
			Self(Cow::Borrowed(trimmed))
		}
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

	/// Convert to an owned Path.
	pub fn to_owned(&self) -> Path {
		Path(self.0.clone().into_owned())
	}
}

impl<'a> From<&'a str> for PathRef<'a> {
	fn from(s: &'a str) -> Self {
		Self::new(s)
	}
}

impl<'a> From<&'a String> for PathRef<'a> {
	fn from(s: &'a String) -> Self {
		Self::new(s.as_str())
	}
}

impl From<String> for PathRef<'static> {
	fn from(s: String) -> Self {
		// It's annoying that this logic is duplicated, but I couldn't figure out how to reuse PathRef::new.
		let trimmed = s.trim_start_matches('/').trim_end_matches('/');

		// Check if we need to normalize (has multiple consecutive slashes)
		if trimmed.contains("//") {
			// Only allocate if we actually need to normalize
			let normalized = trimmed
				.split('/')
				.filter(|s| !s.is_empty())
				.collect::<Vec<_>>()
				.join("/");
			Self(Cow::Owned(normalized))
		} else if trimmed == s {
			// String is already trimmed and normalized, use it directly
			Self(Cow::Owned(s))
		} else {
			// Need to trim but don't need to normalize internal slashes
			Self(Cow::Owned(trimmed.to_string()))
		}
	}
}

impl<'a> From<&'a Path> for PathRef<'a> {
	fn from(p: &'a Path) -> Self {
		// Path is already normalized, so we can use it directly as borrowed
		Self(Cow::Borrowed(p.0.as_str()))
	}
}

impl<'a, 'b> From<&'a PathRef<'b>> for PathRef<'a>
where
	'b: 'a,
{
	fn from(p: &'a PathRef<'b>) -> Self {
		Self(p.0.clone())
	}
}

impl<'a> AsRef<str> for PathRef<'a> {
	fn as_ref(&self) -> &str {
		&self.0
	}
}

impl<'a> Display for PathRef<'a> {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		write!(f, "{}", self.0)
	}
}

/// A broadcast path that provides safe prefix matching operations.
///
/// This type wraps a String but provides path-aware operations that respect
/// delimiter boundaries, preventing issues like "foo" matching "foobar".
///
/// Paths are automatically trimmed of leading and trailing slashes on creation,
/// making all slashes implicit at boundaries.
/// All paths are RELATIVE; you cannot join with a leading slash to make an absolute path.
///
/// # Examples
/// ```
/// use moq_lite::{Path, PathRef};
///
/// // Creation automatically trims slashes
/// let path1 = Path::new("/foo/bar/");
/// let path2 = Path::new("foo/bar");
/// assert_eq!(path1, path2);
///
/// // Methods accept both &str and &Path via PathRef
/// let base = Path::new("api/v1");
/// assert!(base.has_prefix("api"));
/// assert!(base.has_prefix(&Path::new("api/v1")));
///
/// let joined = base.join("users");
/// assert_eq!(joined.as_str(), "api/v1/users");
/// ```
#[derive(Clone, Debug, PartialEq, Eq, Hash, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct Path(String);

impl Path {
	/// Create a new Path from a string or PathRef.
	///
	/// Leading and trailing slashes are automatically trimmed.
	/// Multiple consecutive internal slashes are collapsed to single slashes.
	/// If a PathRef is provided, sanitization is skipped since PathRef is already normalized.
	pub fn new<'a>(path: impl Into<PathRef<'a>>) -> Self {
		// PathRef has already done all the sanitization work
		Self(path.into().0.to_string())
	}

	/// Check if this path has the given prefix, respecting path boundaries.
	///
	/// Unlike String::starts_with, this ensures that "foo" does not match "foobar".
	/// The prefix must either:
	/// - Be exactly equal to this path
	/// - Be followed by a '/' delimiter in the original path
	/// - Be empty (matches everything)
	///
	/// # Examples
	/// ```
	/// use moq_lite::Path;
	///
	/// let path = Path::new("foo/bar");
	/// assert!(path.has_prefix("foo"));
	/// assert!(path.has_prefix(&Path::new("foo")));
	/// assert!(path.has_prefix("foo/"));
	/// assert!(!path.has_prefix("fo"));
	///
	/// let path = Path::new("foobar");
	/// assert!(!path.has_prefix("foo"));
	/// ```
	pub fn has_prefix<'a>(&self, prefix: impl Into<PathRef<'a>>) -> bool {
		let prefix = prefix.into();
		if prefix.is_empty() {
			return true;
		}

		if !self.0.starts_with(prefix.as_str()) {
			return false;
		}

		// Check if the prefix is the exact match
		if self.0.len() == prefix.len() {
			return true;
		}

		// Otherwise, ensure the character after the prefix is a delimiter
		self.0.chars().nth(prefix.len()) == Some('/')
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
	/// let suffix = path.strip_prefix("foo").unwrap();
	/// assert_eq!(suffix.as_str(), "bar/baz");
	///
	/// let prefix = Path::new("foo/");
	/// let suffix = path.strip_prefix(&prefix).unwrap();
	/// assert_eq!(suffix.as_str(), "bar/baz");
	/// ```
	pub fn strip_prefix<'a>(&self, prefix: impl Into<PathRef<'a>>) -> Option<PathRef<'_>> {
		let prefix = prefix.into();
		if !self.has_prefix(&prefix) {
			return None;
		}

		let suffix = &self.0[prefix.len()..];
		// Trim leading slash since paths should not start with /
		let suffix = suffix.trim_start_matches('/');
		Some(PathRef(Cow::Borrowed(suffix)))
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
	/// let joined = base.join(&Path::new("bar"));
	/// assert_eq!(joined.as_str(), "foo/bar");
	/// ```
	pub fn join<'a>(&self, other: impl Into<PathRef<'a>>) -> Path {
		let other = other.into();
		if self.0.is_empty() {
			other.to_owned()
		} else if other.is_empty() {
			self.clone()
		} else {
			// Since paths are trimmed, we always need to add a slash
			Path::new(format!("{}/{}", self.0, other.as_str()))
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
		Self::new(&s)
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

impl From<PathRef<'_>> for Path {
	fn from(p: PathRef<'_>) -> Self {
		Path(p.0.into_owned())
	}
}

impl Decode for Path {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let path = String::decode(r)?;
		Ok(Self::new(&path))
	}
}

impl Encode for Path {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		self.0.encode(w)
	}
}

#[cfg(feature = "serde")]
impl<'de> serde::Deserialize<'de> for Path {
	fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
	where
		D: serde::Deserializer<'de>,
	{
		let s = String::deserialize(deserializer)?;
		Ok(Path::new(&s))
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_has_prefix() {
		let path = Path::new("foo/bar/baz");

		// Valid prefixes - test with both &str and &Path
		assert!(path.has_prefix(""));
		assert!(path.has_prefix("foo"));
		assert!(path.has_prefix(&Path::new("foo")));
		assert!(path.has_prefix("foo/"));
		assert!(path.has_prefix("foo/bar"));
		assert!(path.has_prefix(&Path::new("foo/bar/")));
		assert!(path.has_prefix("foo/bar/baz"));

		// Invalid prefixes - should not match partial components
		assert!(!path.has_prefix("f"));
		assert!(!path.has_prefix(&Path::new("fo")));
		assert!(!path.has_prefix("foo/b"));
		assert!(!path.has_prefix("foo/ba"));
		assert!(!path.has_prefix(&Path::new("foo/bar/ba")));

		// Edge case: "foobar" should not match "foo"
		let path = Path::new("foobar");
		assert!(!path.has_prefix("foo"));
		assert!(path.has_prefix(&Path::new("foobar")));
	}

	#[test]
	fn test_strip_prefix() {
		let path = Path::new("foo/bar/baz");

		// Test with both &str and &Path
		assert_eq!(path.strip_prefix("").unwrap().as_str(), "foo/bar/baz");
		assert_eq!(path.strip_prefix("foo").unwrap().as_str(), "bar/baz");
		assert_eq!(path.strip_prefix(&Path::new("foo/")).unwrap().as_str(), "bar/baz");
		assert_eq!(path.strip_prefix("foo/bar").unwrap().as_str(), "baz");
		assert_eq!(path.strip_prefix(&Path::new("foo/bar/")).unwrap().as_str(), "baz");
		assert_eq!(path.strip_prefix("foo/bar/baz").unwrap().as_str(), "");

		// Should fail for invalid prefixes
		assert!(path.strip_prefix("fo").is_none());
		assert!(path.strip_prefix(&Path::new("bar")).is_none());
	}

	#[test]
	fn test_join() {
		// Test with both &str and &Path
		assert_eq!(Path::new("foo").join("bar").as_str(), "foo/bar");
		assert_eq!(Path::new("foo/").join(&Path::new("bar")).as_str(), "foo/bar");
		assert_eq!(Path::new("").join("bar").as_str(), "bar");
		assert_eq!(Path::new("foo/bar").join(&Path::new("baz")).as_str(), "foo/bar/baz");
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
		let prefix = Path::new("foo");
		let suffix = Path::new("bar/baz");
		let path = prefix.join(&suffix);
		assert_eq!(path.as_str(), "foo/bar/baz");

		let prefix = Path::new("foo/");
		let suffix = Path::new("bar/baz");
		let path = prefix.join(&suffix);
		assert_eq!(path.as_str(), "foo/bar/baz");

		let prefix = Path::new("foo");
		let suffix = Path::new("/bar/baz");
		let path = prefix.join(&suffix);
		assert_eq!(path.as_str(), "foo/bar/baz");

		let prefix = Path::new("");
		let suffix = Path::new("bar/baz");
		let path = prefix.join(&suffix);
		assert_eq!(path.as_str(), "bar/baz");
	}

	#[test]
	fn test_path_prefix_conversions() {
		let prefix1 = Path::from("foo/bar");
		let prefix2 = Path::from(String::from("foo/bar"));
		let s = String::from("foo/bar");
		let prefix3 = Path::from(&s);

		assert_eq!(prefix1.as_str(), "foo/bar");
		assert_eq!(prefix2.as_str(), "foo/bar");
		assert_eq!(prefix3.as_str(), "foo/bar");
	}

	#[test]
	fn test_path_suffix_conversions() {
		let suffix1 = Path::from("foo/bar");
		let suffix2 = Path::from(String::from("foo/bar"));
		let s = String::from("foo/bar");
		let suffix3 = Path::from(&s);

		assert_eq!(suffix1.as_str(), "foo/bar");
		assert_eq!(suffix2.as_str(), "foo/bar");
		assert_eq!(suffix3.as_str(), "foo/bar");
	}

	#[test]
	fn test_path_types_basic_operations() {
		let prefix = Path::new("foo/bar");
		assert_eq!(prefix.as_str(), "foo/bar");
		assert!(!prefix.is_empty());
		assert_eq!(prefix.len(), 7);

		let suffix = Path::new("baz/qux");
		assert_eq!(suffix.as_str(), "baz/qux");
		assert!(!suffix.is_empty());
		assert_eq!(suffix.len(), 7);

		let empty_prefix = Path::new("");
		assert!(empty_prefix.is_empty());
		assert_eq!(empty_prefix.len(), 0);

		let empty_suffix = Path::new("");
		assert!(empty_suffix.is_empty());
		assert_eq!(empty_suffix.len(), 0);
	}

	#[test]
	fn test_prefix_has_prefix() {
		// Test empty prefix (should match everything)
		let prefix = Path::new("foo/bar");
		assert!(prefix.has_prefix(&Path::new("")));

		// Test exact matches
		let prefix = Path::new("foo/bar");
		assert!(prefix.has_prefix(&Path::new("foo/bar")));

		// Test valid prefixes
		assert!(prefix.has_prefix(&Path::new("foo")));
		assert!(prefix.has_prefix(&Path::new("foo/")));

		// Test invalid prefixes - partial matches should fail
		assert!(!prefix.has_prefix(&Path::new("f")));
		assert!(!prefix.has_prefix(&Path::new("fo")));
		assert!(!prefix.has_prefix(&Path::new("foo/b")));
		assert!(!prefix.has_prefix(&Path::new("foo/ba")));

		// Test edge cases
		let prefix = Path::new("foobar");
		assert!(!prefix.has_prefix(&Path::new("foo")));
		assert!(prefix.has_prefix(&Path::new("foobar")));

		// Test trailing slash handling
		let prefix = Path::new("foo/bar/");
		assert!(prefix.has_prefix(&Path::new("foo")));
		assert!(prefix.has_prefix(&Path::new("foo/")));
		assert!(prefix.has_prefix(&Path::new("foo/bar")));
		assert!(prefix.has_prefix(&Path::new("foo/bar/")));

		// Test single component
		let prefix = Path::new("foo");
		assert!(prefix.has_prefix(&Path::new("")));
		assert!(prefix.has_prefix(&Path::new("foo")));
		assert!(prefix.has_prefix(&Path::new("foo/"))); // "foo/" becomes "foo" after trimming
		assert!(!prefix.has_prefix(&Path::new("f")));

		// Test empty prefix
		let prefix = Path::new("");
		assert!(prefix.has_prefix(&Path::new("")));
		assert!(!prefix.has_prefix(&Path::new("foo")));
	}

	#[test]
	fn test_prefix_join() {
		// Basic joining
		let prefix = Path::new("foo");
		let suffix = Path::new("bar");
		assert_eq!(prefix.join(&suffix).as_str(), "foo/bar");

		// Trailing slash on prefix
		let prefix = Path::new("foo/");
		let suffix = Path::new("bar");
		assert_eq!(prefix.join(&suffix).as_str(), "foo/bar");

		// Leading slash on suffix
		let prefix = Path::new("foo");
		let suffix = Path::new("/bar");
		assert_eq!(prefix.join(&suffix).as_str(), "foo/bar");

		// Trailing slash on suffix
		let prefix = Path::new("foo");
		let suffix = Path::new("bar/");
		assert_eq!(prefix.join(&suffix).as_str(), "foo/bar"); // trailing slash is trimmed

		// Both have slashes
		let prefix = Path::new("foo/");
		let suffix = Path::new("/bar");
		assert_eq!(prefix.join(&suffix).as_str(), "foo/bar");

		// Empty suffix
		let prefix = Path::new("foo");
		let suffix = Path::new("");
		assert_eq!(prefix.join(&suffix).as_str(), "foo");

		// Empty prefix
		let prefix = Path::new("");
		let suffix = Path::new("bar");
		assert_eq!(prefix.join(&suffix).as_str(), "bar");

		// Both empty
		let prefix = Path::new("");
		let suffix = Path::new("");
		assert_eq!(prefix.join(&suffix).as_str(), "");

		// Complex paths
		let prefix = Path::new("foo/bar");
		let suffix = Path::new("baz/qux");
		assert_eq!(prefix.join(&suffix).as_str(), "foo/bar/baz/qux");

		// Complex paths with slashes
		let prefix = Path::new("foo/bar/");
		let suffix = Path::new("/baz/qux/");
		assert_eq!(prefix.join(&suffix).as_str(), "foo/bar/baz/qux"); // all slashes are trimmed
	}

	#[test]
	fn test_path_ref() {
		// Test PathRef creation and normalization
		let ref1 = PathRef::new("/foo/bar/");
		assert_eq!(ref1.as_str(), "foo/bar");

		let ref2 = PathRef::from("///foo///");
		assert_eq!(ref2.as_str(), "foo");

		// Test PathRef normalizes multiple slashes
		let ref3 = PathRef::new("foo//bar///baz");
		assert_eq!(ref3.as_str(), "foo/bar/baz");

		// Test conversions
		let path = Path::new("foo/bar");
		let path_ref = PathRef::from(&path);
		assert_eq!(path_ref.as_str(), "foo/bar");

		// Test that Path methods work with PathRef
		let path2 = Path::new("foo/bar/baz");
		assert!(path2.has_prefix(&path_ref));
		assert_eq!(path2.strip_prefix(&path_ref).unwrap().as_str(), "baz");

		// Test empty PathRef
		let empty = PathRef::new("");
		assert!(empty.is_empty());
		assert_eq!(empty.len(), 0);
	}

	#[test]
	fn test_multiple_consecutive_slashes() {
		let path = Path::new("foo//bar///baz");
		// Multiple consecutive slashes are collapsed to single slashes
		assert_eq!(path.as_str(), "foo/bar/baz");

		// Test with leading and trailing slashes too
		let path2 = Path::new("//foo//bar///baz//");
		assert_eq!(path2.as_str(), "foo/bar/baz");

		// Test empty segments are handled correctly
		let path3 = Path::new("foo///bar");
		assert_eq!(path3.as_str(), "foo/bar");
	}

	#[test]
	fn test_removes_multiple_slashes_comprehensively() {
		// Test various multiple slash scenarios
		assert_eq!(Path::new("foo//bar").as_str(), "foo/bar");
		assert_eq!(Path::new("foo///bar").as_str(), "foo/bar");
		assert_eq!(Path::new("foo////bar").as_str(), "foo/bar");

		// Multiple occurrences of double slashes
		assert_eq!(Path::new("foo//bar//baz").as_str(), "foo/bar/baz");
		assert_eq!(Path::new("a//b//c//d").as_str(), "a/b/c/d");

		// Mixed slash counts
		assert_eq!(Path::new("foo//bar///baz////qux").as_str(), "foo/bar/baz/qux");

		// With leading and trailing slashes
		assert_eq!(Path::new("//foo//bar//").as_str(), "foo/bar");
		assert_eq!(Path::new("///foo///bar///").as_str(), "foo/bar");

		// Edge case: only slashes
		assert_eq!(Path::new("//").as_str(), "");
		assert_eq!(Path::new("////").as_str(), "");

		// Test that operations work correctly with normalized paths
		let path_with_slashes = Path::new("foo//bar///baz");
		assert!(path_with_slashes.has_prefix("foo/bar"));
		assert_eq!(path_with_slashes.strip_prefix("foo").unwrap().as_str(), "bar/baz");
		assert_eq!(path_with_slashes.join("qux").as_str(), "foo/bar/baz/qux");

		// Test PathRef to Path conversion
		let path_ref = PathRef::new("foo//bar///baz");
		assert_eq!(path_ref.as_str(), "foo/bar/baz"); // PathRef now normalizes too
		let path_from_ref = path_ref.to_owned();
		assert_eq!(path_from_ref.as_str(), "foo/bar/baz"); // Both are normalized
	}

	#[test]
	fn test_path_ref_multiple_slashes() {
		// PathRef now normalizes multiple slashes using Cow
		let path_ref = PathRef::new("//foo//bar///baz//");
		assert_eq!(path_ref.as_str(), "foo/bar/baz"); // Fully normalized

		// Various multiple slash scenarios are normalized in PathRef
		assert_eq!(PathRef::new("foo//bar").as_str(), "foo/bar");
		assert_eq!(PathRef::new("foo///bar").as_str(), "foo/bar");
		assert_eq!(PathRef::new("a//b//c//d").as_str(), "a/b/c/d");

		// Conversion to Path maintains normalized form
		assert_eq!(PathRef::new("foo//bar").to_owned().as_str(), "foo/bar");
		assert_eq!(PathRef::new("foo///bar").to_owned().as_str(), "foo/bar");
		assert_eq!(PathRef::new("a//b//c//d").to_owned().as_str(), "a/b/c/d");

		// Edge cases
		assert_eq!(PathRef::new("//").as_str(), "");
		assert_eq!(PathRef::new("////").as_str(), "");
		assert_eq!(PathRef::new("//").to_owned().as_str(), "");
		assert_eq!(PathRef::new("////").to_owned().as_str(), "");

		// Test that PathRef avoids allocation when no normalization needed
		let normal_path = PathRef::new("foo/bar/baz");
		assert_eq!(normal_path.as_str(), "foo/bar/baz");
		// This should use Cow::Borrowed internally (no allocation)

		let needs_norm = PathRef::new("foo//bar");
		assert_eq!(needs_norm.as_str(), "foo/bar");
		// This should use Cow::Owned internally (allocation only when needed)
	}

	#[test]
	fn test_ergonomic_conversions() {
		// Test that all these work ergonomically in function calls
		fn takes_path_ref<'a>(p: impl Into<PathRef<'a>>) -> String {
			p.into().as_str().to_string()
		}

		// Alternative API using the trait alias for better error messages
		fn takes_path_ref_with_trait<'a>(p: impl IntoPathRef<'a>) -> String {
			p.into().as_str().to_string()
		}

		// String literal
		assert_eq!(takes_path_ref("foo//bar"), "foo/bar");

		// String (owned) - this should now work without &
		let owned_string = String::from("foo//bar///baz");
		assert_eq!(takes_path_ref(owned_string), "foo/bar/baz");

		// &String
		let string_ref = String::from("foo//bar");
		assert_eq!(takes_path_ref(&string_ref), "foo/bar");

		// PathRef
		let path_ref = PathRef::new("foo//bar");
		assert_eq!(takes_path_ref(&path_ref), "foo/bar");

		// Path
		let path = Path::new("foo//bar");
		assert_eq!(takes_path_ref(&path), "foo/bar");

		// Test that Path::new works with all these types
		let _path1 = Path::new("foo/bar"); // &str
		let _path2 = Path::new(String::from("foo/bar")); // String - should now work
		let _path3 = Path::new(String::from("foo/bar")); // &String
		let _path4 = Path::new(PathRef::new("foo/bar")); // PathRef

		// Test the trait alias version works the same
		assert_eq!(takes_path_ref_with_trait("foo//bar"), "foo/bar");
		assert_eq!(takes_path_ref_with_trait(String::from("foo//bar")), "foo/bar");
	}

	#[test]
	fn test_prefix_strip_prefix() {
		// Test basic stripping
		let prefix = Path::new("foo/bar/baz");
		assert_eq!(prefix.strip_prefix(&Path::new("")).unwrap().as_str(), "foo/bar/baz");
		assert_eq!(prefix.strip_prefix(&Path::new("foo")).unwrap().as_str(), "bar/baz");
		assert_eq!(prefix.strip_prefix(&Path::new("foo/")).unwrap().as_str(), "bar/baz");
		assert_eq!(prefix.strip_prefix(&Path::new("foo/bar")).unwrap().as_str(), "baz");
		assert_eq!(prefix.strip_prefix(&Path::new("foo/bar/")).unwrap().as_str(), "baz");
		assert_eq!(prefix.strip_prefix(&Path::new("foo/bar/baz")).unwrap().as_str(), "");

		// Test invalid prefixes
		assert!(prefix.strip_prefix(&Path::new("fo")).is_none());
		assert!(prefix.strip_prefix(&Path::new("bar")).is_none());
		assert!(prefix.strip_prefix(&Path::new("foo/ba")).is_none());

		// Test edge cases
		let prefix = Path::new("foobar");
		assert!(prefix.strip_prefix(&Path::new("foo")).is_none());
		assert_eq!(prefix.strip_prefix(&Path::new("foobar")).unwrap().as_str(), "");

		// Test empty prefix
		let prefix = Path::new("");
		assert_eq!(prefix.strip_prefix(&Path::new("")).unwrap().as_str(), "");
		assert!(prefix.strip_prefix(&Path::new("foo")).is_none());

		// Test single component
		let prefix = Path::new("foo");
		assert_eq!(prefix.strip_prefix(&Path::new("foo")).unwrap().as_str(), "");
		assert_eq!(prefix.strip_prefix(&Path::new("foo/")).unwrap().as_str(), ""); // "foo/" becomes "foo" after trimming

		// Test trailing slash handling
		let prefix = Path::new("foo/bar/");
		assert_eq!(prefix.strip_prefix(&Path::new("foo")).unwrap().as_str(), "bar");
		assert_eq!(prefix.strip_prefix(&Path::new("foo/")).unwrap().as_str(), "bar");
		assert_eq!(prefix.strip_prefix(&Path::new("foo/bar")).unwrap().as_str(), "");
		assert_eq!(prefix.strip_prefix(&Path::new("foo/bar/")).unwrap().as_str(), "");
	}
}
