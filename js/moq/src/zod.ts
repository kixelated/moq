// Helper containers for Zod-validated track encoding/decoding.

import type * as z from "zod";
import type { Group } from "./group.ts";
import type { Track } from "./track.ts";

export async function read<T = unknown>(source: Track | Group, schema: z.ZodSchema<T>): Promise<T | undefined> {
	const next = await source.readJson();
	if (next === undefined) return undefined; // only treat undefined as EOF, not other falsy values
	return schema.parse(next);
}

export function write<T = unknown>(source: Track | Group, value: T, schema: z.ZodSchema<T>) {
	const valid = schema.parse(value);
	source.writeJson(valid);
}
