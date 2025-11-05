import { z } from "zod";

export const PreviewSchema = z.object({
	name: z.string().optional(), // name
	avatar: z.string().optional(), // avatar

	audio: z.boolean().optional(), // audio enabled
	video: z.boolean().optional(), // video enabled

	typing: z.boolean().optional(), // actively typing
	chat: z.boolean().optional(), // chatted recently
	screen: z.boolean().optional(), // screen sharing
});

export type Preview = z.infer<typeof PreviewSchema>;
