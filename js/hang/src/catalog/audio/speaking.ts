import { z } from "zod";
import { TrackSchema } from "../track";

export const SpeakingSchema = z.object({
	// The MoQ track information.
	track: TrackSchema,
});

export type Speaking = z.infer<typeof SpeakingSchema>;
