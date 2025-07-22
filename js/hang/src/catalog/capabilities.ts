import { z } from "zod";

export const VideoCapabilitiesSchema = z.object({
	hardware: z.array(z.string()).optional(),
	software: z.array(z.string()).optional(),
	unsupported: z.array(z.string()).optional(),
});

export const AudioCapabilitiesSchema = z.object({
	hardware: z.array(z.string()).optional(),
	software: z.array(z.string()).optional(),
	unsupported: z.array(z.string()).optional(),
});

export const CapabilitiesSchema = z.object({
	video: VideoCapabilitiesSchema.optional(),
	audio: AudioCapabilitiesSchema.optional(),
});

export type Capabilities = z.infer<typeof CapabilitiesSchema>;
export type VideoCapabilities = z.infer<typeof VideoCapabilitiesSchema>;
export type AudioCapabilities = z.infer<typeof AudioCapabilitiesSchema>;
