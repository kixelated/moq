import { z } from "zod";

export const InfoSchema = z.object({
	name: z.string().optional(),
	avatar: z.string().optional(),
	audio: z.boolean().optional(),
	video: z.boolean().optional(),
	chat: z.boolean().optional(),
	speaking: z.boolean().optional(),
	typing: z.boolean().optional(),
});

export type Info = z.infer<typeof InfoSchema>;
