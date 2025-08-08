import type * as Moq from "@kixelated/moq";
import { z } from "zod";

import { AudioSchema } from "./audio";
import { CapabilitiesSchema } from "./capabilities";
import { ChatSchema } from "./chat";
import { DetectionSchema } from "./detection";
import { LocationSchema } from "./location";
import { UserSchema } from "./user";
import { VideoSchema } from "./video";

export const RootSchema = z.object({
	video: z.array(VideoSchema).optional(),
	audio: z.array(AudioSchema).optional(),
	location: LocationSchema.optional(),
	user: UserSchema.optional(),
	chat: ChatSchema.optional(),
	detection: DetectionSchema.optional(),
	capabilities: CapabilitiesSchema.optional(),
});

export type Root = z.infer<typeof RootSchema>;

export function encode(root: Root): Uint8Array {
	const encoder = new TextEncoder();
	return encoder.encode(JSON.stringify(root));
}

export function decode(raw: Uint8Array): Root {
	const decoder = new TextDecoder();
	const str = decoder.decode(raw);
	try {
		const json = JSON.parse(str);
		return RootSchema.parse(json);
	} catch (error) {
		console.warn("invalid catalog", str);
		throw error;
	}
}

export async function fetch(track: Moq.TrackConsumer): Promise<Root | undefined> {
	const frame = await track.nextFrame();
	if (!frame) return undefined;
	return decode(frame.data);
}
