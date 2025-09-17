import { z } from "zod";

export const TrackSchema = z.union([
	z.string(),
	// TODO remove backwards compatibility
	z
		.object({
			name: z.string(),
			priority: z.number().int().min(0).max(255),
		})
		.transform((val) => val.name),
]);
export type Track = z.infer<typeof TrackSchema>;
