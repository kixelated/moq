import assert from "node:assert";
import test from "node:test";
import { type Claims, claimsSchema, validateClaims } from "./claims";

const createTestClaims = (): Claims => ({
	path: "test-path/",
	pub: "test-pub",
	sub: "test-sub",
	cluster: false,
	exp: Math.floor((Date.now() + 3600 * 1000) / 1000),
	iat: Math.floor(Date.now() / 1000),
});

test("claims schema - valid claims", () => {
	const claims = createTestClaims();
	const result = claimsSchema.parse(claims);

	assert.strictEqual(result.path, claims.path);
	assert.strictEqual(result.pub, claims.pub);
	assert.strictEqual(result.sub, claims.sub);
	assert.strictEqual(result.cluster, claims.cluster);
	assert.strictEqual(result.exp, claims.exp);
	assert.strictEqual(result.iat, claims.iat);
});

test("claims schema - minimal valid claims with pub", () => {
	const claims = {
		path: "test-path/",
		pub: "test-pub",
	};
	const result = claimsSchema.parse(claims);

	assert.strictEqual(result.path, claims.path);
	assert.strictEqual(result.pub, claims.pub);
	assert.strictEqual(result.sub, undefined);
	assert.strictEqual(result.cluster, undefined);
	assert.strictEqual(result.exp, undefined);
	assert.strictEqual(result.iat, undefined);
});

test("claims schema - minimal valid claims with sub", () => {
	const claims = {
		path: "test-path/",
		sub: "test-sub",
	};
	const result = claimsSchema.parse(claims);

	assert.strictEqual(result.path, claims.path);
	assert.strictEqual(result.pub, undefined);
	assert.strictEqual(result.sub, claims.sub);
	assert.strictEqual(result.cluster, undefined);
	assert.strictEqual(result.exp, undefined);
	assert.strictEqual(result.iat, undefined);
});

test("claims schema - invalid claims without pub or sub", () => {
	const claims = {
		path: "test-path/",
		cluster: false,
	};

	assert.throws(() => {
		claimsSchema.parse(claims);
	}, /Either pub or sub must be specified/);
});

test("claims schema - missing required path", () => {
	const claims = {
		pub: "test-pub",
	};

	assert.throws(() => {
		claimsSchema.parse(claims);
	}, /Required|missing|invalid_type/);
});

test("claims schema - invalid field types", () => {
	assert.throws(() => {
		claimsSchema.parse({
			path: 123, // should be string
			pub: "test-pub",
		});
	}, /Expected string|invalid_type/);

	assert.throws(() => {
		claimsSchema.parse({
			path: "test-path/",
			pub: 123, // should be string
		});
	}, /Expected string|invalid_type/);

	assert.throws(() => {
		claimsSchema.parse({
			path: "test-path/",
			pub: "test-pub",
			cluster: "true", // should be boolean
		});
	}, /Expected boolean|invalid_type/);

	assert.throws(() => {
		claimsSchema.parse({
			path: "test-path/",
			pub: "test-pub",
			exp: "123", // should be number
		});
	}, /Expected number|invalid_type/);
});

test("validateClaims - success", () => {
	const claims = createTestClaims();
	assert.doesNotThrow(() => {
		validateClaims(claims);
	});
});

test("validateClaims - only pub", () => {
	const claims: Claims = {
		path: "test-path/",
		pub: "test-pub",
	};
	assert.doesNotThrow(() => {
		validateClaims(claims);
	});
});

test("validateClaims - only sub", () => {
	const claims: Claims = {
		path: "test-path/",
		sub: "test-sub",
	};
	assert.doesNotThrow(() => {
		validateClaims(claims);
	});
});

test("validateClaims - no pub or sub", () => {
	const claims: Claims = {
		path: "test-path/",
	};

	assert.throws(() => {
		validateClaims(claims);
	}, /no pub or sub paths specified; token is useless/);
});

test("validateClaims - path not prefix relative pub", () => {
	const claims: Claims = {
		path: "test-path", // no trailing slash
		pub: "relative-pub", // relative path without leading slash
	};

	assert.throws(() => {
		validateClaims(claims);
	}, /path is not a prefix, so pub can't be relative/);
});

test("validateClaims - path not prefix relative sub", () => {
	const claims: Claims = {
		path: "test-path", // no trailing slash
		sub: "relative-sub", // relative path without leading slash
	};

	assert.throws(() => {
		validateClaims(claims);
	}, /path is not a prefix, so sub can't be relative/);
});

test("validateClaims - path not prefix absolute pub", () => {
	const claims: Claims = {
		path: "test-path", // no trailing slash
		pub: "/absolute-pub", // absolute path with leading slash
	};

	assert.doesNotThrow(() => {
		validateClaims(claims);
	});
});

test("validateClaims - path not prefix absolute sub", () => {
	const claims: Claims = {
		path: "test-path", // no trailing slash
		sub: "/absolute-sub", // absolute path with leading slash
	};

	assert.doesNotThrow(() => {
		validateClaims(claims);
	});
});

test("validateClaims - path not prefix empty pub", () => {
	const claims: Claims = {
		path: "test-path", // no trailing slash
		pub: "", // empty string
		sub: "/test-sub", // absolute path
	};

	assert.doesNotThrow(() => {
		validateClaims(claims);
	});
});

test("validateClaims - path not prefix empty sub", () => {
	const claims: Claims = {
		path: "test-path", // no trailing slash
		sub: "", // empty string
		pub: "/test-pub", // absolute path
	};

	assert.doesNotThrow(() => {
		validateClaims(claims);
	});
});

test("validateClaims - path is prefix with relative paths", () => {
	const claims: Claims = {
		path: "test-path/", // with trailing slash
		pub: "relative-pub", // relative path is ok when path is prefix
		sub: "relative-sub", // relative path is ok when path is prefix
	};

	assert.doesNotThrow(() => {
		validateClaims(claims);
	});
});

test("validateClaims - empty path", () => {
	const claims: Claims = {
		path: "", // empty path
		pub: "test-pub",
	};

	assert.doesNotThrow(() => {
		validateClaims(claims);
	});
});

test("validateClaims - complex path validation scenarios", () => {
	// Test edge cases for path validation
	const testCases = [
		// Valid cases
		{ path: "test/", pub: "relative", shouldPass: true },
		{ path: "test", pub: "/absolute", shouldPass: true },
		{ path: "test", pub: "", sub: "/test-sub", shouldPass: true },
		{ path: "", pub: "anything", shouldPass: true },

		// Invalid cases
		{ path: "test", pub: "relative", shouldPass: false },
		{ path: "test", sub: "relative", shouldPass: false },
	];

	testCases.forEach(({ path, pub, sub, shouldPass }) => {
		const claims: Claims = {
			path,
			...(pub !== undefined && { pub }),
			...(sub !== undefined && { sub }),
		};

		if (shouldPass) {
			assert.doesNotThrow(
				() => {
					validateClaims(claims);
				},
				`Should pass: ${JSON.stringify(claims)}`,
			);
		} else {
			assert.throws(
				() => {
					validateClaims(claims);
				},
				Error,
				`Should fail: ${JSON.stringify(claims)}`,
			);
		}
	});
});

test("validateClaims - both pub and sub with path validation", () => {
	// When both pub and sub are present, both need to follow the rules
	const claims: Claims = {
		path: "test-path", // no trailing slash
		pub: "relative-pub", // relative path without leading slash
		sub: "/absolute-sub", // absolute path with leading slash
	};

	assert.throws(() => {
		validateClaims(claims);
	}, /path is not a prefix, so pub can't be relative/);
});

test("validateClaims - both pub and sub valid", () => {
	const claims: Claims = {
		path: "test-path", // no trailing slash
		pub: "/absolute-pub", // absolute path with leading slash
		sub: "/absolute-sub", // absolute path with leading slash
	};

	assert.doesNotThrow(() => {
		validateClaims(claims);
	});
});

test("claims schema - additional properties ignored", () => {
	const claims = {
		path: "test-path/",
		pub: "test-pub",
		unexpectedField: "should be ignored",
	};

	const result = claimsSchema.parse(claims);
	assert.strictEqual(result.path, claims.path);
	assert.strictEqual(result.pub, claims.pub);
	assert.strictEqual((result as Record<string, unknown>).unexpectedField, undefined);
});

test("claims schema - optional fields default to undefined", () => {
	const claims = {
		path: "test-path/",
		pub: "test-pub",
	};

	const result = claimsSchema.parse(claims);
	assert.strictEqual(result.sub, undefined);
	assert.strictEqual(result.cluster, undefined);
	assert.strictEqual(result.exp, undefined);
	assert.strictEqual(result.iat, undefined);
});
