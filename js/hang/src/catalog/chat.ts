import { z } from "zod";
import { TrackSchema } from "./track";

export const ChatSchema = z.object({
	message: TrackSchema.optional(),
	typing: TrackSchema.optional(),
});

export type Chat = z.infer<typeof ChatSchema>;
