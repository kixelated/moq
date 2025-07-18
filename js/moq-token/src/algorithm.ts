import { z } from "zod";

/**
 * Supported JWT algorithms.
 *
 * We currently only support HMAC algorithms since the relay can fetch any resource it wants;
 * it doesn't need to forge tokens.
 *
 * TODO: Support public key crypto at some point.
 */
export const algorithmSchema = z.enum(["HS256", "HS384", "HS512"]);
export type Algorithm = z.infer<typeof algorithmSchema>;
