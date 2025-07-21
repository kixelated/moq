import assert from "node:assert";
import test from "node:test";
import { Path } from './path';

test('Path constructor trims leading and trailing slashes', () => {
	assert.strictEqual(new Path('/foo/bar/').toString(), 'foo/bar');
	assert.strictEqual(new Path('///foo/bar///').toString(), 'foo/bar');
	assert.strictEqual(new Path('foo/bar').toString(), 'foo/bar');
});

test('Path constructor handles empty paths', () => {
	assert.strictEqual(new Path('').toString(), '');
	assert.strictEqual(new Path('/').toString(), '');
	assert.strictEqual(new Path('///').toString(), '');
});

test('Path constructor accepts Path instances', () => {
	const original = new Path('foo/bar');
	const copy = new Path(original);
	assert.strictEqual(copy.toString(), 'foo/bar');
	assert.strictEqual(copy.equals(original), true);
});

test('hasPrefix matches exact paths', () => {
	const path = new Path('foo/bar');
	assert.strictEqual(path.hasPrefix('foo/bar'), true);
	assert.strictEqual(path.hasPrefix(new Path('foo/bar')), true);
});

test('hasPrefix matches proper prefixes', () => {
	const path = new Path('foo/bar/baz');
	assert.strictEqual(path.hasPrefix('foo'), true);
	assert.strictEqual(path.hasPrefix('foo/bar'), true);
	assert.strictEqual(path.hasPrefix(new Path('foo')), true);
});

test('hasPrefix does not match partial segment prefixes', () => {
	const path = new Path('foobar');
	assert.strictEqual(path.hasPrefix('foo'), false);
	
	const path2 = new Path('foo/bar');
	assert.strictEqual(path2.hasPrefix('fo'), false);
});

test('hasPrefix handles empty prefix', () => {
	const path = new Path('foo/bar');
	assert.strictEqual(path.hasPrefix(''), true);
	assert.strictEqual(path.hasPrefix(Path.empty()), true);
});

test('hasPrefix ignores trailing slashes in prefix', () => {
	const path = new Path('foo/bar');
	assert.strictEqual(path.hasPrefix('foo/'), true);
	assert.strictEqual(path.hasPrefix('foo/bar/'), true);
});

test('stripPrefix strips valid prefixes', () => {
	const path = new Path('foo/bar/baz');
	
	const suffix1 = path.stripPrefix('foo');
	assert.strictEqual(suffix1?.toString(), 'bar/baz');
	
	const suffix2 = path.stripPrefix('foo/bar');
	assert.strictEqual(suffix2?.toString(), 'baz');
	
	const suffix3 = path.stripPrefix('foo/bar/baz');
	assert.strictEqual(suffix3?.toString(), '');
});

test('stripPrefix returns null for invalid prefixes', () => {
	const path = new Path('foo/bar');
	assert.strictEqual(path.stripPrefix('notfound'), null);
	assert.strictEqual(path.stripPrefix('fo'), null);
});

test('stripPrefix handles empty prefix', () => {
	const path = new Path('foo/bar');
	const result = path.stripPrefix('');
	assert.strictEqual(result?.toString(), 'foo/bar');
});

test('stripPrefix accepts Path instances', () => {
	const path = new Path('foo/bar/baz');
	const prefix = new Path('foo/bar');
	const result = path.stripPrefix(prefix);
	assert.strictEqual(result?.toString(), 'baz');
});

test('join paths with slashes', () => {
	const base = new Path('foo');
	const joined = base.join('bar');
	assert.strictEqual(joined.toString(), 'foo/bar');
});

test('join handles empty base', () => {
	const base = Path.empty();
	const joined = base.join('bar');
	assert.strictEqual(joined.toString(), 'bar');
});

test('join handles empty suffix', () => {
	const base = new Path('foo');
	const joined = base.join('');
	assert.strictEqual(joined.toString(), 'foo');
});

test('join accepts Path instances', () => {
	const base = new Path('foo');
	const suffix = new Path('bar');
	const joined = base.join(suffix);
	assert.strictEqual(joined.toString(), 'foo/bar');
});

test('join handles multiple joins', () => {
	const path = new Path('api')
		.join('v1')
		.join('users')
		.join('123');
	assert.strictEqual(path.toString(), 'api/v1/users/123');
});

test('isEmpty checks correctly', () => {
	assert.strictEqual(new Path('').isEmpty(), true);
	assert.strictEqual(new Path('foo').isEmpty(), false);
	assert.strictEqual(Path.empty().isEmpty(), true);
});

test('length property works correctly', () => {
	assert.strictEqual(new Path('foo').length, 3);
	assert.strictEqual(new Path('foo/bar').length, 7);
	assert.strictEqual(Path.empty().length, 0);
});

test('equals checks correctly', () => {
	const path1 = new Path('foo/bar');
	const path2 = new Path('/foo/bar/');
	const path3 = new Path('foo/baz');
	
	assert.strictEqual(path1.equals(path2), true);
	assert.strictEqual(path1.equals('foo/bar'), true);
	assert.strictEqual(path1.equals(path3), false);
});

test('JSON serialization works', () => {
	const path = new Path('foo/bar');
	assert.strictEqual(JSON.stringify(path), '"foo/bar"');
});

test('handles paths with multiple consecutive slashes', () => {
	const path = new Path('foo//bar///baz');
	// Multiple consecutive slashes are collapsed to single slashes
	assert.strictEqual(path.toString(), 'foo/bar/baz');
});

test('removes multiple slashes comprehensively', () => {
	// Test various multiple slash scenarios
	assert.strictEqual(new Path('foo//bar').toString(), 'foo/bar');
	assert.strictEqual(new Path('foo///bar').toString(), 'foo/bar');
	assert.strictEqual(new Path('foo////bar').toString(), 'foo/bar');
	
	// Multiple occurrences of double slashes
	assert.strictEqual(new Path('foo//bar//baz').toString(), 'foo/bar/baz');
	assert.strictEqual(new Path('a//b//c//d').toString(), 'a/b/c/d');
	
	// Mixed slash counts
	assert.strictEqual(new Path('foo//bar///baz////qux').toString(), 'foo/bar/baz/qux');
	
	// With leading and trailing slashes
	assert.strictEqual(new Path('//foo//bar//').toString(), 'foo/bar');
	assert.strictEqual(new Path('///foo///bar///').toString(), 'foo/bar');
	
	// Edge case: only slashes
	assert.strictEqual(new Path('//').toString(), '');
	assert.strictEqual(new Path('////').toString(), '');
	
	// Test that operations work correctly with normalized paths
	const pathWithSlashes = new Path('foo//bar///baz');
	assert.strictEqual(pathWithSlashes.hasPrefix('foo/bar'), true);
	assert.strictEqual(pathWithSlashes.stripPrefix('foo')?.toString(), 'bar/baz');
	assert.strictEqual(pathWithSlashes.join('qux').toString(), 'foo/bar/baz/qux');
});

test('handles special characters', () => {
	const path = new Path('foo-bar_baz.txt');
	assert.strictEqual(path.toString(), 'foo-bar_baz.txt');
	assert.strictEqual(path.hasPrefix('foo-bar'), false);
	assert.strictEqual(path.hasPrefix('foo-bar_baz.txt'), true);
});