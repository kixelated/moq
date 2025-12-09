import assert from "node:assert";
import test from "node:test";
import { AlgorithmSchema } from "./algorithm";

test("algorithm schema - valid algorithms", () => {
	assert.strictEqual(AlgorithmSchema.parse("HS256"), "HS256");
	assert.strictEqual(AlgorithmSchema.parse("HS384"), "HS384");
	assert.strictEqual(AlgorithmSchema.parse("HS512"), "HS512");
});

test("algorithm schema - invalid algorithms", () => {
	assert.throws(() => {
		AlgorithmSchema.parse("HS128");
	}, /Invalid option/);

	assert.throws(() => {
		AlgorithmSchema.parse("RS256");
	}, /Invalid option/);

	assert.throws(() => {
		AlgorithmSchema.parse("invalid");
	}, /Invalid option/);

	assert.throws(() => {
		AlgorithmSchema.parse("");
	}, /Invalid option/);
});

test("algorithm schema - type safety", () => {
	// Test that TypeScript types are working correctly
	const validAlgorithm = AlgorithmSchema.parse("HS256");
	assert.ok(typeof validAlgorithm === "string");
	assert.ok(["HS256", "HS384", "HS512"].includes(validAlgorithm));
});

test("algorithm schema - case sensitivity", () => {
	assert.throws(() => {
		AlgorithmSchema.parse("hs256");
	}, /Invalid option/);

	assert.throws(() => {
		AlgorithmSchema.parse("Hs256");
	}, /Invalid option/);

	assert.throws(() => {
		AlgorithmSchema.parse("HS256 ");
	}, /Invalid option/);
});

test("algorithm schema - non-string inputs", () => {
	assert.throws(() => {
		AlgorithmSchema.parse(256);
	}, /Expected string|Invalid option/);

	assert.throws(() => {
		AlgorithmSchema.parse(null);
	}, /Expected string|Invalid option/);

	assert.throws(() => {
		AlgorithmSchema.parse(undefined);
	}, /Expected string|Invalid option/);

	assert.throws(() => {
		AlgorithmSchema.parse({});
	}, /Expected string|Invalid option/);
});
