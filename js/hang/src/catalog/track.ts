import { z } from "zod";
import { u8Schema } from "./integers";

export const TrackSchema = z.object({
	name: z.string(),
	priority: u8Schema,
});

export type Track = z.infer<typeof TrackSchema>;
