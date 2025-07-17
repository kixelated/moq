import { z } from "zod/mini";

export const claimsSchema = z
	.object({
		root: z.optional(z.string()),
		publish: z.optional(z.string()),
		cluster: z.optional(z.boolean()),
		subscribe: z.optional(z.string()),
		expires: z.optional(z.date()),
		issued: z.optional(z.date()),
	})
	.check(
		z.refine((data) => data.publish || data.subscribe, {
			message: "Either publish or subscribe must be specified",
		}),
	);

/**
 * JWT claims structure for moq-token
 */
export type Claims = z.infer<typeof claimsSchema>;
