import assert from "node:assert";
import test from "node:test";
import * as base64 from "@hexagon/base64";
import type { Claims } from "./claims";
import { load, sign, verify } from "./key";

// Helper function to encode JSON to base64url
function encodeJwk(obj: unknown): string {
	const jsonString = JSON.stringify(obj);
	const data = new TextEncoder().encode(jsonString);
	return base64.fromArrayBuffer(data.buffer as ArrayBuffer, true); // true for urlSafe
}

const testKey = {
	alg: "HS256",
	key_ops: ["sign", "verify"],
	k: "dGVzdC1zZWNyZXQtdGhhdC1pcy1sb25nLWVub3VnaC1mb3ItaG1hYy1zaGEyNTY", // "test-secret-that-is-long-enough-for-hmac-sha256" in base64url
	kid: "test-key-1",
} as const;

const testClaims: Claims = {
	root: "test-path",
	pub: "test-pub",
	sub: "test-sub",
	cluster: false,
	exp: Math.floor((Date.now() + 60 * 1000) / 1000), // 1 minute from now in seconds
	iat: Math.floor(Date.now() / 1000), // now in seconds
};

test("load - valid JWK", () => {
	const jwk = encodeJwk(testKey);
	const key = load(jwk);

	assert.strictEqual(key.alg, "HS256");
	assert.deepEqual(key.key_ops, ["sign", "verify"]);
	assert.strictEqual(key.k, testKey.k);
	assert.strictEqual(key.kid, "test-key-1");
});

test("load - invalid base64url", () => {
	const invalidJwk = "invalid-base64url!@#$%";

	assert.throws(() => {
		load(invalidJwk);
	});
});

test("load - invalid JSON after base64url decode", () => {
	// Base64url encode invalid JSON
	const data = new TextEncoder().encode("invalid json");
	const invalidJwk = base64.fromArrayBuffer(data.buffer as ArrayBuffer, true); // true for urlSafe

	assert.throws(() => {
		load(invalidJwk);
	});
});

test("load - invalid secret format", () => {
	const invalidKey = {
		...testKey,
		k: "invalid-base64url-chars!@#$%",
	};
	const jwk = encodeJwk(invalidKey);

	assert.throws(() => {
		load(jwk);
	});
});

test("load - secret too short", () => {
	const invalidKey = {
		...testKey,
		k: "c2hvcnQ", // "short" in base64url (only 5 bytes)
	};
	const jwk = encodeJwk(invalidKey);

	assert.throws(() => {
		load(jwk);
	});
});

test("load - missing required fields", () => {
	const invalidKey = {
		alg: "HS256",
		// missing key_ops and k
	};
	const jwk = encodeJwk(invalidKey);

	assert.throws(() => {
		load(jwk);
	});
});

test("sign - successful signing", async () => {
	const key = load(encodeJwk(testKey));
	const token = await sign(key, testClaims);

	assert.ok(typeof token === "string");
	assert.ok(token.length > 0);
	assert.ok(token.split(".").length === 3); // JWT format: header.payload.signature
});

test("sign - key doesn't support signing", async () => {
	const verifyOnlyKey = {
		...testKey,
		key_ops: ["verify"],
	};
	const key = load(encodeJwk(verifyOnlyKey));

	await assert.rejects(async () => {
		await sign(key, testClaims);
	});
});

test("verify - successful verification", async () => {
	const key = load(encodeJwk(testKey));
	const token = await sign(key, testClaims);
	const claims = await verify(key, token, testClaims.root);

	assert.strictEqual(claims.root, testClaims.root);
	assert.strictEqual(claims.pub, testClaims.pub);
	assert.strictEqual(claims.sub, testClaims.sub);
	assert.strictEqual(claims.cluster, testClaims.cluster);
});

test("verify - key doesn't support verification", async () => {
	const signOnlyKey = {
		...testKey,
		key_ops: ["sign"],
	};
	const key = load(encodeJwk(signOnlyKey));

	await assert.rejects(async () => {
		await verify(key, "some.jwt.token", "test-path");
	});
});

test("verify - invalid token format", async () => {
	const key = load(encodeJwk(testKey));

	await assert.rejects(async () => {
		await verify(key, "invalid-token", "test-path");
	});
});

test("verify - expired token", async () => {
	const expiredClaims: Claims = {
		...testClaims,
		exp: Math.floor((Date.now() - 60 * 1000) / 1000), // 1 minute ago in seconds
	};

	const key = load(encodeJwk(testKey));
	const token = await sign(key, expiredClaims);

	await assert.rejects(async () => {
		await verify(key, token, expiredClaims.root);
	});
});

test("verify - token without exp field", async () => {
	const claimsWithoutExp: Claims = {
		root: "test-path",
		pub: "test-pub",
	};

	const key = load(encodeJwk(testKey));
	const token = await sign(key, claimsWithoutExp);
	const claims = await verify(key, token, claimsWithoutExp.root);

	assert.strictEqual(claims.root, "test-path");
	assert.strictEqual(claims.pub, "test-pub");
	assert.strictEqual(claims.exp, undefined);
});

test("claims validation - must have pub or sub", async () => {
	const invalidClaims = {
		root: "test-path",
		cluster: false,
		// missing both pub and sub
	};

	const key = load(encodeJwk(testKey));

	await assert.rejects(async () => {
		await sign(key, invalidClaims as Claims);
	});
});

test("round-trip - sign and verify", async () => {
	const key = load(encodeJwk(testKey));
	const originalClaims: Claims = {
		root: "test-path",
		pub: "test-pub",
		sub: "test-sub",
		cluster: true,
		exp: Math.floor((Date.now() + 60 * 1000) / 1000),
		iat: Math.floor(Date.now() / 1000),
	};

	const token = await sign(key, originalClaims);
	const verifiedClaims = await verify(key, token, originalClaims.root);

	assert.strictEqual(verifiedClaims.root, originalClaims.root);
	assert.strictEqual(verifiedClaims.pub, originalClaims.pub);
	assert.strictEqual(verifiedClaims.sub, originalClaims.sub);
	assert.strictEqual(verifiedClaims.cluster, originalClaims.cluster);
	assert.strictEqual(verifiedClaims.exp, originalClaims.exp);
	assert.strictEqual(verifiedClaims.iat, originalClaims.iat);
});

test("verify - path mismatch", async () => {
	const key = load(encodeJwk(testKey));
	const token = await sign(key, testClaims);

	await assert.rejects(async () => {
		await verify(key, token, "different-path");
	});
});

test("sign - invalid claims without pub or sub", async () => {
	const key = load(encodeJwk(testKey));
	const invalidClaims = {
		root: "test-path",
		cluster: false,
	};

	await assert.rejects(async () => {
		await sign(key, invalidClaims as Claims);
	});
});

test("sign - claims validation path not prefix absolute sub", async () => {
	const key = load(encodeJwk(testKey));
	const validClaims: Claims = {
		root: "test-path",
		sub: "absolute-sub",
	};

	const token = await sign(key, validClaims);
	assert.ok(typeof token === "string");
	assert.ok(token.length > 0);
});

test("sign - claims validation path is prefix with relative paths", async () => {
	const key = load(encodeJwk(testKey));
	const validClaims: Claims = {
		root: "test-path",
		pub: "relative-pub",
		sub: "relative-sub",
	};

	const token = await sign(key, validClaims);
	assert.ok(typeof token === "string");
	assert.ok(token.length > 0);
});

test("sign - claims validation empty root", async () => {
	const key = load(encodeJwk(testKey));
	const validClaims: Claims = {
		root: "",
		pub: "test-pub",
	};

	const token = await sign(key, validClaims);
	assert.ok(typeof token === "string");
	assert.ok(token.length > 0);
});

test("different algorithms - HS384", async () => {
	const hs384Key = {
		alg: "HS384",
		key_ops: ["sign", "verify"],
		k: "dGVzdC1zZWNyZXQtdGhhdC1pcy1sb25nLWVub3VnaC1mb3ItaG1hYy1zaGEzODQtYWxnb3JpdGhtLXRlc3RpbmctcHVycG9zZXM", // longer secret for HS384
		kid: "test-key-hs384",
	} as const;

	const key = load(encodeJwk(hs384Key));
	const token = await sign(key, testClaims);
	const verifiedClaims = await verify(key, token, testClaims.root);

	assert.strictEqual(verifiedClaims.root, testClaims.root);
	assert.strictEqual(verifiedClaims.pub, testClaims.pub);
});

test("different algorithms - HS512", async () => {
	const hs512Key = {
		alg: "HS512",
		key_ops: ["sign", "verify"],
		k: "dGVzdC1zZWNyZXQtdGhhdC1pcy1sb25nLWVub3VnaC1mb3ItaG1hYy1zaGE1MTItYWxnb3JpdGhtLXRlc3RpbmctcHVycG9zZXMtYW5kLW1vcmUtZGF0YQ", // longer secret for HS512
		kid: "test-key-hs512",
	} as const;

	const key = load(encodeJwk(hs512Key));
	const token = await sign(key, testClaims);
	const verifiedClaims = await verify(key, token, testClaims.root);

	assert.strictEqual(verifiedClaims.root, testClaims.root);
	assert.strictEqual(verifiedClaims.pub, testClaims.pub);
});

test("cross-algorithm verification fails", async () => {
	const hs256Key = load(encodeJwk(testKey));
	const hs384Key = load(
		encodeJwk({
			alg: "HS384",
			key_ops: ["sign", "verify"],
			k: "dGVzdC1zZWNyZXQtdGhhdC1pcy1sb25nLWVub3VnaC1mb3ItaG1hYy1zaGEzODQtYWxnb3JpdGhtLXRlc3RpbmctcHVycG9zZXM",
			kid: "test-key-hs384",
		}),
	);

	const token = await sign(hs256Key, testClaims);

	await assert.rejects(async () => {
		await verify(hs384Key, token, testClaims.root);
	});
});

test("load - invalid algorithm", () => {
	const invalidKey = {
		...testKey,
		alg: "RS256", // unsupported algorithm
	};
	const jwk = encodeJwk(invalidKey);

	assert.throws(() => {
		load(jwk);
	});
});

test("load - invalid key_ops", () => {
	const invalidKey = {
		...testKey,
		key_ops: ["invalid-operation"],
	};
	const jwk = encodeJwk(invalidKey);

	assert.throws(() => {
		load(jwk);
	});
});

test("load - missing alg field", () => {
	const invalidKey = {
		key_ops: ["sign", "verify"],
		k: testKey.k,
	};
	const jwk = encodeJwk(invalidKey);

	assert.throws(() => {
		load(jwk);
	});
});

test("sign - includes kid in header when present", async () => {
	const key = load(encodeJwk(testKey));
	const token = await sign(key, testClaims);

	// Decode the header to verify kid is present
	const [headerB64] = token.split(".");
	const headerBuffer = base64.toArrayBuffer(headerB64, true); // true for urlSafe
	const header = JSON.parse(new TextDecoder().decode(headerBuffer));

	assert.strictEqual(header.kid, "test-key-1");
	assert.strictEqual(header.alg, "HS256");
	assert.strictEqual(header.typ, "JWT");
});

test("sign - no kid in header when not present", async () => {
	const keyWithoutKid = {
		...testKey,
		kid: undefined,
	};
	delete keyWithoutKid.kid;

	const key = load(encodeJwk(keyWithoutKid));
	const token = await sign(key, testClaims);

	// Decode the header to verify kid is not present
	const [headerB64] = token.split(".");
	const headerBuffer = base64.toArrayBuffer(headerB64, true); // true for urlSafe
	const header = JSON.parse(new TextDecoder().decode(headerBuffer));

	assert.strictEqual(header.kid, undefined);
	assert.strictEqual(header.alg, "HS256");
	assert.strictEqual(header.typ, "JWT");
});

test("sign - sets issued at timestamp", async () => {
	const key = load(encodeJwk(testKey));
	const claimsWithoutIat: Claims = {
		root: "test-path",
		pub: "test-pub",
	};

	const beforeSign = Math.floor(Date.now() / 1000);
	const token = await sign(key, claimsWithoutIat);
	const afterSign = Math.floor(Date.now() / 1000);

	// Decode the payload to verify iat is set
	const [, payloadB64] = token.split(".");
	const payloadBuffer = base64.toArrayBuffer(payloadB64, true); // true for urlSafe
	const payload = JSON.parse(new TextDecoder().decode(payloadBuffer));

	assert.ok(payload.iat >= beforeSign);
	assert.ok(payload.iat <= afterSign);
});

test("verify - malformed token parts", async () => {
	const key = load(encodeJwk(testKey));

	await assert.rejects(async () => {
		await verify(key, "invalid", "test-path");
	});

	await assert.rejects(async () => {
		await verify(key, "invalid.token", "test-path");
	});

	await assert.rejects(async () => {
		await verify(key, "invalid.token.signature.extra", "test-path");
	});
});

test("verify - invalid payload structure", async () => {
	const key = load(encodeJwk(testKey));

	// Create a token with invalid payload structure
	const headerData = new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
	const header = base64.fromArrayBuffer(headerData.buffer as ArrayBuffer, true); // true for urlSafe

	const payloadData = new TextEncoder().encode(JSON.stringify({ invalid: "payload" }));
	const payload = base64.fromArrayBuffer(payloadData.buffer as ArrayBuffer, true); // true for urlSafe
	const signature = "invalid";
	const invalidToken = `${header}.${payload}.${signature}`;

	await assert.rejects(async () => {
		await verify(key, invalidToken, "test-path");
	});
});

test("verify - claims validation during verification", async () => {
	const key = load(encodeJwk(testKey));

	// We need to create a token with valid claims since sign() would reject invalid ones
	const token = await sign(key, { root: "test-path", pub: "/absolute-pub" });

	// Test that valid tokens pass verification
	const verifiedClaims = await verify(key, token, "test-path");
	assert.strictEqual(verifiedClaims.root, "test-path");
});
