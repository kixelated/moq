import { z } from "zod";
import { TrackSchema } from "./track";

export const DetectionSchema = z.object({
	track: TrackSchema,
});

export type Detection = z.infer<typeof DetectionSchema>;

export const DetectionObjectSchema = z.object({
	label: z.string(),
	score: z.number().min(0).max(1),
	x: z.number().min(0).max(1),
	y: z.number().min(0).max(1),
	w: z.number().min(0).max(1),
	h: z.number().min(0).max(1),
});

export type DetectionObject = z.infer<typeof DetectionObjectSchema>;

export const DetectionObjectsSchema = z.array(DetectionObjectSchema);
export type DetectionObjects = z.infer<typeof DetectionObjectsSchema>;
