import * as jose from "jose";
import { z } from "zod";
import * as base64 from "@hexagon/base64";
import { AlgorithmSchema } from "./algorithm";
import { type Claims, ClaimsSchema, validateClaims } from "./claims";

/**
 * Key operations that can be performed
 */
export const OperationSchema = z.enum(["sign", "verify", "decrypt", "encrypt"]);
export type Operation = z.infer<typeof OperationSchema>;

/**
 * Key interface for JWT operations - matches Rust implementation
 */
export const KeySchema = z.object({
	alg: AlgorithmSchema,
	key_ops: z.array(OperationSchema),
	k: z
		.string()
		.refine(
			(secret) => {
				// Validate base64url encoding
				const base64urlRegex = /^[A-Za-z0-9_-]+$/;
				return base64urlRegex.test(secret);
			},
			{
				message: "Secret must be valid base64url encoded",
			},
		)
		.refine(
			(secret) => {
				// Validate minimum length (at least 32 bytes when decoded)
				try {
					const decoded = base64.toArrayBuffer(secret, true); // true for urlSafe
					return decoded.byteLength >= 32;
				} catch {
					return false;
				}
			},
			{
				message: "Secret must be at least 32 bytes when decoded",
			},
		),
	kid: z.string().optional(),
});
export type Key = z.infer<typeof KeySchema>;

export function load(jwk: string): Key {
	let data: unknown;
	try {
		// First base64url decode the input
		const decoded = base64.toArrayBuffer(jwk, true); // true for urlSafe
		const jsonString = new TextDecoder().decode(decoded);
		data = JSON.parse(jsonString);
	} catch (error) {
		if (error instanceof Error && error.message.includes("Invalid character")) {
			throw new Error("Failed to decode JWK: invalid base64url encoding");
		}
		throw new Error("Failed to parse JWK: invalid JSON format");
	}

	try {
		const key = KeySchema.parse(data);
		return key;
	} catch (error) {
		throw new Error(`Failed to validate JWK: ${error instanceof Error ? error.message : "unknown error"}`);
	}
}

export async function sign(key: Key, claims: Claims): Promise<string> {
	if (!key.key_ops.includes("sign")) {
		throw new Error("Key does not support signing operation");
	}

	// Validate claims before signing
	try {
		ClaimsSchema.parse(claims);
		validateClaims(claims);
	} catch (error) {
		throw new Error(`Invalid claims: ${error instanceof Error ? error.message : "unknown error"}`);
	}

	// Convert base64url to Uint8Array
	const secretBuffer = base64.toArrayBuffer(key.k, true); // true for urlSafe
	const secret = new Uint8Array(secretBuffer);
	const jwt = await new jose.SignJWT(claims)
		.setProtectedHeader({
			alg: key.alg,
			typ: "JWT",
			...(key.kid && { kid: key.kid }),
		})
		.setIssuedAt()
		.sign(secret);

	return jwt;
}

export async function verify(key: Key, token: string, path: string): Promise<Claims> {
	if (!key.key_ops.includes("verify")) {
		throw new Error("Key does not support verification operation");
	}

	// Convert base64url to Uint8Array
	const secretBuffer = base64.toArrayBuffer(key.k, true); // true for urlSafe
	const secret = new Uint8Array(secretBuffer);
	const { payload } = await jose.jwtVerify(token, secret, {
		algorithms: [key.alg],
	});

	let claims: Claims;
	try {
		claims = ClaimsSchema.parse(payload);
	} catch (error) {
		throw new Error(`Failed to parse token claims: ${error instanceof Error ? error.message : "unknown error"}`);
	}

	// Validate path matches
	if (claims.path !== path) {
		throw new Error("Token path does not match provided path");
	}

	// Validate claims structure and business rules
	validateClaims(claims);

	return claims;
}
