import * as jose from "jose";
import { z } from "zod/mini";
import { algorithmSchema } from "./algorithm.js";
import { type Claims, claimsSchema } from "./claims.js";

/**
 * Key operations that can be performed
 */
export const operationSchema = z.enum(["sign", "verify", "decrypt", "encrypt"]);
export type Operation = z.infer<typeof operationSchema>;

/**
 * Key interface for JWT operations
 */
export const keySchema = z.object({
	algorithm: algorithmSchema,
	operations: z.array(operationSchema),
	secret: z.string(),
	kid: z.optional(z.string()),
});
export type Key = z.infer<typeof keySchema>;

export function load(jwk: string): Key {
	const data = JSON.parse(jwk);
	const key = keySchema.parse(data);
	return key;
}

export async function sign(key: Key, claims: Claims): Promise<string> {
	if (!key.operations.includes("sign")) {
		throw new Error("Key does not support signing");
	}

	const secret = Buffer.from(key.secret, "base64url");
	const jwt = await new jose.SignJWT(claims)
		.setProtectedHeader({
			alg: key.algorithm,
			typ: "JWT",
			...(key.kid && { kid: key.kid }),
		})
		.setIssuedAt()
		.sign(secret);

	return jwt;
}

export async function verify(key: Key, token: string): Promise<Claims> {
	if (!key.operations.includes("verify")) {
		throw new Error("Key does not support verification");
	}

	const secret = Buffer.from(key.secret, "base64url");
	const { payload } = await jose.jwtVerify(token, secret, {
		algorithms: [key.algorithm],
	});

	const claims = claimsSchema.parse(payload);

	return claims;
}
