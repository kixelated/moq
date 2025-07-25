import assert from "node:assert";
import test from "node:test";
import * as Path from "./path";

test("Path constructor trims leading and trailing slashes", () => {
	assert.strictEqual(Path.from("/foo/bar/"), "foo/bar");
	assert.strictEqual(Path.from("///foo/bar///"), "foo/bar");
	assert.strictEqual(Path.from("foo/bar"), "foo/bar");
});

test("Path constructor handles empty paths", () => {
	assert.strictEqual(Path.from(""), "");
	assert.strictEqual(Path.from("/"), "");
	assert.strictEqual(Path.from("///"), "");
});

test("hasPrefix matches exact paths", () => {
	const path = Path.from("foo/bar");
	assert.strictEqual(Path.hasPrefix(Path.from("foo/bar"), path), true);
});

test("hasPrefix matches proper prefixes", () => {
	const path = Path.from("foo/bar/baz");
	assert.strictEqual(Path.hasPrefix(Path.from("foo"), path), true);
	assert.strictEqual(Path.hasPrefix(Path.from("foo/bar"), path), true);
});

test("hasPrefix does not match partial segment prefixes", () => {
	const path = Path.from("foobar");
	assert.strictEqual(Path.hasPrefix(Path.from("foo"), path), false);

	const path2 = Path.from("foo/bar");
	assert.strictEqual(Path.hasPrefix(Path.from("fo"), path2), false);
});

test("hasPrefix handles empty prefix", () => {
	const path = Path.from("foo/bar");
	assert.strictEqual(Path.hasPrefix(Path.empty(), path), true);
});

test("hasPrefix ignores trailing slashes in prefix", () => {
	const path = Path.from("foo/bar");
	assert.strictEqual(Path.hasPrefix(Path.from("foo/"), path), true);
	assert.strictEqual(Path.hasPrefix(Path.from("foo/bar/"), path), true);
});

test("stripPrefix strips valid prefixes", () => {
	const path = Path.from("foo/bar/baz");

	const suffix1 = Path.stripPrefix(Path.from("foo"), path);
	assert.strictEqual(suffix1, "bar/baz");

	const suffix2 = Path.stripPrefix(Path.from("foo/bar"), path);
	assert.strictEqual(suffix2, "baz");

	const suffix3 = Path.stripPrefix(Path.from("foo/bar/baz"), path);
	assert.strictEqual(suffix3, "");
});

test("stripPrefix returns null for invalid prefixes", () => {
	const path = Path.from("foo/bar");
	assert.strictEqual(Path.stripPrefix(Path.from("notfound"), path), null);
	assert.strictEqual(Path.stripPrefix(Path.from("fo"), path), null);
});

test("stripPrefix handles empty prefix", () => {
	const path = Path.from("foo/bar");
	const result = Path.stripPrefix(Path.empty(), path);
	assert.strictEqual(result, "foo/bar");
});

test("stripPrefix accepts Path instances", () => {
	const path = Path.from("foo/bar/baz");
	const prefix = Path.from("foo/bar");
	const result = Path.stripPrefix(prefix, path);
	assert.strictEqual(result, "baz");
});

test("from paths with slashes", () => {
	const base = Path.from("foo");
	const fromed = Path.from(base, Path.from("bar"));
	assert.strictEqual(fromed, "foo/bar");
});

test("from handles empty base", () => {
	const base = Path.empty();
	const fromed = Path.from(base, Path.from("bar"));
	assert.strictEqual(fromed, "bar");
});

test("from handles empty suffix", () => {
	const base = Path.from("foo");
	const fromed = Path.from(base, Path.empty());
	assert.strictEqual(fromed, "foo");
});

test("from accepts Path instances", () => {
	const base = Path.from("foo");
	const suffix = Path.from("bar");
	const fromed = Path.from(base, suffix);
	assert.strictEqual(fromed, "foo/bar");
});

test("from handles multiple froms", () => {
	const path = Path.from(
		Path.from(Path.from(Path.from("api"), Path.from("v1")), Path.from("users")),
		Path.from("123"),
	);
	assert.strictEqual(path, "api/v1/users/123");
});

test("isEmpty checks correctly", () => {
	assert.strictEqual(Path.from("") === "", true);
	assert.strictEqual(Path.from("foo") === "", false);
	assert.strictEqual(Path.empty() === "", true);
});

test("length property works correctly", () => {
	assert.strictEqual(Path.from("foo").length, 3);
	assert.strictEqual(Path.from("foo/bar").length, 7);
	assert.strictEqual(Path.empty().length, 0);
});

test("equals checks correctly", () => {
	const path1 = Path.from("foo/bar");
	const path2 = Path.from("/foo/bar/");
	const path3 = Path.from("foo/baz");

	assert.strictEqual(path1 === path2, true);
	assert.strictEqual(path1 === path3, false);
});

test("JSON serialization works", () => {
	const path = Path.from("foo/bar");
	assert.strictEqual(JSON.stringify(path), '"foo/bar"');
});

test("handles paths with multiple consecutive slashes", () => {
	const path = Path.from("foo//bar///baz");
	// Multiple consecutive slashes are collapsed to single slashes
	assert.strictEqual(path, "foo/bar/baz");
});

test("removes multiple slashes comprehensively", () => {
	// Test various multiple slash scenarios
	assert.strictEqual(Path.from("foo//bar"), "foo/bar");
	assert.strictEqual(Path.from("foo///bar"), "foo/bar");
	assert.strictEqual(Path.from("foo////bar"), "foo/bar");

	// Multiple occurrences of double slashes
	assert.strictEqual(Path.from("foo//bar//baz"), "foo/bar/baz");
	assert.strictEqual(Path.from("a//b//c//d"), "a/b/c/d");

	// Mixed slash counts
	assert.strictEqual(Path.from("foo//bar///baz////qux"), "foo/bar/baz/qux");

	// With leading and trailing slashes
	assert.strictEqual(Path.from("//foo//bar//"), "foo/bar");
	assert.strictEqual(Path.from("///foo///bar///"), "foo/bar");

	// Edge case: only slashes
	assert.strictEqual(Path.from("//"), "");
	assert.strictEqual(Path.from("////"), "");

	// Test that operations work correctly with normalized paths
	const pathWithSlashes = Path.from("foo//bar///baz");
	assert.strictEqual(Path.hasPrefix(Path.from("foo/bar"), pathWithSlashes), true);
	assert.strictEqual(Path.stripPrefix(Path.from("foo"), pathWithSlashes), "bar/baz");
	assert.strictEqual(Path.from(pathWithSlashes, Path.from("qux")), "foo/bar/baz/qux");
});

test("handles special characters", () => {
	const path = Path.from("foo-bar_baz.txt");
	assert.strictEqual(path, "foo-bar_baz.txt");
	assert.strictEqual(Path.hasPrefix(Path.from("foo-bar"), path), false);
	assert.strictEqual(Path.hasPrefix(Path.from("foo-bar_baz.txt"), path), true);
});

test("from accepts multiple arguments", () => {
	assert.strictEqual(Path.from("foo", "bar", "baz"), "foo/bar/baz");
	assert.strictEqual(Path.from("api", "v1", "users"), "api/v1/users");
});

test("from handles empty strings in arguments", () => {
	assert.strictEqual(Path.from("foo", "", "bar"), "foo/bar");
	assert.strictEqual(Path.from("", "foo", "bar", ""), "foo/bar");
});

test("from sanitizes multiple arguments with slashes", () => {
	assert.strictEqual(Path.from("/foo/", "/bar/", "/baz/"), "foo/bar/baz");
	assert.strictEqual(Path.from("foo//", "//bar", "baz"), "foo/bar/baz");
});
