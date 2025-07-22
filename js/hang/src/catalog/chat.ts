import { z } from "zod";
import { TrackSchema } from "./track";

export const ChatSchema = z.object({
	track: TrackSchema,

	// If provided, the number of milliseconds before messages should be deleted.
	ttl: z.number().optional(),
});

export type Chat = z.infer<typeof ChatSchema>;
