import { z } from "zod/v4-mini";

export const PreviewSchema = z.object({
	displayName: z.string(),
	avatar: z.optional(z.string()),
	audio: z.boolean(),
	video: z.boolean(),
});

export type Preview = z.infer<typeof PreviewSchema>;
