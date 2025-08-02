import { z } from "zod";
import { TrackSchema } from "./track";

export const ChatSchema = z.object({
	track: TrackSchema,
});

export type Chat = z.infer<typeof ChatSchema>;
