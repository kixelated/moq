import { z } from "zod";

export const claimsSchema = z
	.object({
		path: z.string(),
		pub: z.optional(z.string()),
		cluster: z.optional(z.boolean()),
		sub: z.optional(z.string()),
		exp: z.optional(z.number()),
		iat: z.optional(z.number()),
	})
	.refine((data) => data.pub || data.sub, {
		message: "Either pub or sub must be specified",
	});

/**
 * JWT claims structure for moq-token
 */
export type Claims = z.infer<typeof claimsSchema>;

/**
 * Validate claims structure and business rules
 */
export function validateClaims(claims: Claims): void {
	if (!claims.pub && !claims.sub) {
		throw new Error("no pub or sub paths specified; token is useless");
	}

	if (!claims.path.endsWith("/") && claims.path !== "") {
		// If the path doesn't end with /, then we need to make sure the other paths are empty or start with /
		if (claims.pub && !claims.pub.startsWith("/") && claims.pub !== "") {
			throw new Error("path is not a prefix, so pub can't be relative");
		}

		if (claims.sub && !claims.sub.startsWith("/") && claims.sub !== "") {
			throw new Error("path is not a prefix, so sub can't be relative");
		}
	}
}
