import { z } from "zod/v4-mini";

export const TrackSchema = z.object({
	name: z.string(),
	priority: z.number(), // u8 (0-255) validated by wire protocol
});

export type Track = z.infer<typeof TrackSchema>;
