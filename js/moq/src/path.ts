/**
 * A broadcast path that provides safe prefix matching operations.
 *
 * This class wraps a string but provides path-aware operations that respect
 * delimiter boundaries, preventing issues like "foo" matching "foobar".
 *
 * Paths are automatically trimmed of leading and trailing slashes on creation,
 * making all slashes implicit at boundaries.
 * All paths are RELATIVE; you cannot join with a leading slash to make an absolute path.
 *
 * @example
 * ```typescript
 * // Creation automatically trims slashes
 * const path1 = new Path("/foo/bar/");
 * const path2 = new Path("foo/bar");
 * console.log(path1.equals(path2)); // true
 *
 * // Safe prefix matching
 * const base = new Path("api/v1");
 * console.log(base.hasPrefix("api")); // true
 * console.log(base.hasPrefix(new Path("api/v1"))); // true
 *
 * const joined = base.join("users");
 * console.log(joined.toString()); // "api/v1/users"
 * ```
 */
export class Path {
	#path: string;

	/**
	 * Create a new Path from a string or another Path.
	 *
	 * Leading and trailing slashes are automatically trimmed.
	 */
	constructor(path: string | Path) {
		if (path instanceof Path) {
			// Trust the other Path instance to have already been normalized.
			this.#path = path.#path;
		} else {
			// Remove leading and trailing slashes, and collapse multiple slashes into one.
			this.#path = path.replace(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
		}
	}

	/**
	 * Check if this path has the given prefix, respecting path boundaries.
	 *
	 * Unlike String.startsWith, this ensures that "foo" does not match "foobar".
	 * The prefix must either:
	 * - Be exactly equal to this path
	 * - Be followed by a '/' delimiter in the original path
	 * - Be empty (matches everything)
	 *
	 * @example
	 * ```typescript
	 * const path = new Path("foo/bar");
	 * console.log(path.hasPrefix("foo")); // true
	 * console.log(path.hasPrefix(new Path("foo"))); // true
	 * console.log(path.hasPrefix("foo/")); // true (trailing slash ignored)
	 * console.log(path.hasPrefix("fo")); // false
	 *
	 * const path2 = new Path("foobar");
	 * console.log(path2.hasPrefix("foo")); // false
	 * ```
	 */
	hasPrefix(prefix: string | Path): boolean {
		const prefixStr = new Path(prefix).#path;

		if (prefixStr === '') {
			return true;
		}

		if (!this.#path.startsWith(prefixStr)) {
			return false;
		}

		// Check if the prefix is the exact match
		if (this.#path.length === prefixStr.length) {
			return true;
		}

		// Otherwise, ensure the character after the prefix is a delimiter
		return this.#path[prefixStr.length] === '/';
	}

	/**
	 * Strip the given prefix from this path, returning the suffix.
	 *
	 * Returns null if the prefix doesn't match according to hasPrefix rules.
	 *
	 * @example
	 * ```typescript
	 * const path = new Path("foo/bar/baz");
	 * const suffix = path.stripPrefix("foo");
	 * console.log(suffix?.toString()); // "bar/baz"
	 *
	 * const suffix2 = path.stripPrefix(new Path("foo/"));
	 * console.log(suffix2?.toString()); // "bar/baz"
	 *
	 * const noMatch = path.stripPrefix("notfound");
	 * console.log(noMatch); // null
	 * ```
	 */
	stripPrefix(prefix: string | Path): Path | null {
		const prefixPath = new Path(prefix);
		if (!this.hasPrefix(prefixPath)) {
			return null;
		}

		// Handle empty prefix case
		if (prefixPath.#path === '') {
			return new Path(this);
		}

		// For non-empty prefix, skip the prefix and the following slash
		const suffix = Path.empty();
		suffix.#path = this.#path.slice(prefixPath.length + 1);
		return suffix;
	}

	/**
	 * Join this path with another path component.
	 *
	 * @example
	 * ```typescript
	 * const base = new Path("foo");
	 * const joined = base.join("bar");
	 * console.log(joined.toString()); // "foo/bar"
	 *
	 * const joined2 = base.join(new Path("bar"));
	 * console.log(joined2.toString()); // "foo/bar"
	 * ```
	 */
	join(other: string | Path): Path {
		const otherPath = new Path(other);

		if (this.#path === '') {
			return otherPath;
		} else if (otherPath.#path === '') {
			return this;
		} else {
			// Since paths are trimmed, we always need to add a slash
			// We avoid performing the regex; we know this is legit.
			const joined = Path.empty();
			joined.#path = `${this.#path}/${otherPath.#path}`;
			return joined;
		}
	}

	/**
	 * Check if this path is empty.
	 */
	isEmpty(): boolean {
		return this.#path === '';
	}

	/**
	 * Get the length of the path in characters.
	 */
	get length(): number {
		return this.#path.length;
	}

	/**
	 * Get the path as a string.
	 */
	toString(): string {
		return this.#path;
	}

	/**
	 * Check if this path equals another path.
	 */
	equals(other: string | Path): boolean {
		const otherPath = new Path(other);
		return this.#path === otherPath.#path;
	}

	/**
	 * Convert to JSON representation.
	 */
	toJSON(): string {
		return this.#path;
	}

	/**
	 * Static method to create an empty path.
	 */
	static empty(): Path {
		return new Path('');
	}
}
