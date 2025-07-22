import { z } from "zod/v4-mini";

export const TrackSchema = z.object({
	name: z.string(),
	priority: z.int().check(z.nonnegative()).check(z.lt(256)),
});

export type Track = z.infer<typeof TrackSchema>;
