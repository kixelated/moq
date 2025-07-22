import { z } from "zod";

export const UserSchema = z.object({
	id: z.string().optional(),
	name: z.string().optional(),
	avatar: z.string().optional(), // TODO allow using a track instead of a URL?
	color: z.string().optional(),
});

export type User = z.infer<typeof UserSchema>;
