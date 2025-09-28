import { z } from "zod";

import { u53Schema } from "../integers";
import { TrackSchema } from "../track";
import { DetectionSchema } from "./detection";

export * from "./detection";

// Mirrors VideoDecoderConfig
// https://w3c.github.io/webcodecs/#video-decoder-config
export const VideoConfigSchema = z.object({
	// See: https://w3c.github.io/webcodecs/codec_registry.html
	codec: z.string(),

	// The description is used for some codecs.
	// If provided, we can initialize the decoder based on the catalog alone.
	// Otherwise, the initialization information is (repeated) before each key-frame.
	description: z.string().optional(), // hex encoded TODO use base64

	// The width and height of the video in pixels
	codedWidth: u53Schema.optional(),
	codedHeight: u53Schema.optional(),

	// The display aspect ratio of the video in pixels.
	displayRatioWidth: u53Schema.optional(),
	displayRatioHeight: u53Schema.optional(),

	// The frame rate of the video in frames per second
	framerate: z.number().optional(),

	// The bitrate of the video in bits per second
	// TODO: Support up to Number.MAX_SAFE_INTEGER
	bitrate: u53Schema.optional(),

	// If true, the decoder will optimize for latency.
	// Default: true
	optimizeForLatency: z.boolean().optional(),

	// The rotation of the video in degrees.
	// Default: 0
	rotation: z.number().optional(),

	// If true, the decoder will flip the video horizontally
	// Default: false
	flip: z.boolean().optional(),
});

export const VideoRenditionSchema = z.object({
	track: TrackSchema,
	config: VideoConfigSchema,
});

export const VideoSchema = z.object({
	// Each video track available.
	renditions: z.array(VideoRenditionSchema),

	// AI object detection.
	detection: DetectionSchema.optional(),
});

export type Video = z.infer<typeof VideoSchema>;
export type VideoConfig = z.infer<typeof VideoConfigSchema>;
export type VideoRendition = z.infer<typeof VideoRenditionSchema>;
export type VideoRenditions = VideoRendition[];
