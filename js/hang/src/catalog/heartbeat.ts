import { z } from "zod";
import { TrackSchema } from "./track";

export const HeartbeatSchema = z.object({
	track: TrackSchema,
});

export type Heartbeat = z.infer<typeof HeartbeatSchema>;
