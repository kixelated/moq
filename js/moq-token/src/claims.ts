import { z } from "zod";

export const ClaimsSchema = z
	.object({
		root: z.string(),
		pub: z.string().optional(),
		cluster: z.boolean().optional(),
		sub: z.string().optional(),
		exp: z.number().optional(),
		iat: z.number().optional(),
	})
	.refine((data) => data.pub || data.sub, {
		message: "Either pub or sub must be specified",
	});

/**
 * JWT claims structure for moq-token
 */
export type Claims = z.infer<typeof ClaimsSchema>;

/**
 * Validate claims structure and business rules
 */
export function validateClaims(claims: Claims): void {
	if (!claims.pub && !claims.sub) {
		throw new Error("no pub or sub paths specified; token is useless");
	}
}
