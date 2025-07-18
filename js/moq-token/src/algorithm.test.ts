import assert from "node:assert";
import test from "node:test";
import { algorithmSchema } from "./algorithm";

test("algorithm schema - valid algorithms", () => {
	assert.strictEqual(algorithmSchema.parse("HS256"), "HS256");
	assert.strictEqual(algorithmSchema.parse("HS384"), "HS384");
	assert.strictEqual(algorithmSchema.parse("HS512"), "HS512");
});

test("algorithm schema - invalid algorithms", () => {
	assert.throws(() => {
		algorithmSchema.parse("HS128");
	}, /Invalid option/);

	assert.throws(() => {
		algorithmSchema.parse("RS256");
	}, /Invalid option/);

	assert.throws(() => {
		algorithmSchema.parse("invalid");
	}, /Invalid option/);

	assert.throws(() => {
		algorithmSchema.parse("");
	}, /Invalid option/);
});

test("algorithm schema - type safety", () => {
	// Test that TypeScript types are working correctly
	const validAlgorithm = algorithmSchema.parse("HS256");
	assert.ok(typeof validAlgorithm === "string");
	assert.ok(["HS256", "HS384", "HS512"].includes(validAlgorithm));
});

test("algorithm schema - case sensitivity", () => {
	assert.throws(() => {
		algorithmSchema.parse("hs256");
	}, /Invalid option/);

	assert.throws(() => {
		algorithmSchema.parse("Hs256");
	}, /Invalid option/);

	assert.throws(() => {
		algorithmSchema.parse("HS256 ");
	}, /Invalid option/);
});

test("algorithm schema - non-string inputs", () => {
	assert.throws(() => {
		algorithmSchema.parse(256);
	}, /Expected string|Invalid option/);

	assert.throws(() => {
		algorithmSchema.parse(null);
	}, /Expected string|Invalid option/);

	assert.throws(() => {
		algorithmSchema.parse(undefined);
	}, /Expected string|Invalid option/);

	assert.throws(() => {
		algorithmSchema.parse({});
	}, /Expected string|Invalid option/);
});
