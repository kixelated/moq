// Helper containers for Zod-validated track encoding/decoding.

import type * as z from "zod";
import type { GroupConsumer, GroupProducer } from "./group";
import type { TrackConsumer, TrackProducer } from "./track";

export async function read<T = unknown>(
	source: TrackConsumer | GroupConsumer,
	schema: z.ZodType<T>,
): Promise<T | undefined> {
	const next = await source.readJson();
	if (next === undefined) return undefined; // only treat undefined as EOF, not other falsy values
	return schema.parse(next);
}

export function write<T = unknown>(source: TrackProducer | GroupProducer, value: T, schema: z.ZodType<T>) {
	const valid = schema.parse(value);
	source.writeJson(valid);
}
