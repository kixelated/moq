import { z } from "zod";

export const TrackSchema = z.string();
export type Track = z.infer<typeof TrackSchema>;
