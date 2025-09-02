import { z } from "zod";
import { TrackSchema } from "../track";

export const CaptionsSchema = z.object({
	// The MoQ track information.
	track: TrackSchema,
});

export type Captions = z.infer<typeof CaptionsSchema>;
