import { z } from "zod";

export const TrackSchema = z.object({
	name: z.string(),
	priority: z.number().int().min(0).max(255),
});
export type Track = z.infer<typeof TrackSchema>;
