import { z } from "zod";

import { u53Schema } from "./integers";
import { TrackSchema } from "./track";

// Based on VideoDecoderConfig
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

	// Ratio of display width/height to coded width/height
	// Allows stretching/squishing individual "pixels" of the video
	// If not provided, the display ratio is 1:1
	displayAspectWidth: u53Schema.optional(),
	displayAspectHeight: u53Schema.optional(),

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

// Mirrors VideoDecoderConfig
// https://w3c.github.io/webcodecs/#video-decoder-config
export const VideoSchema = z.object({
	// The MoQ track information.
	track: TrackSchema,

	// The configuration of the video track
	config: VideoConfigSchema,
});

export type Video = z.infer<typeof VideoSchema>;
export type VideoConfig = z.infer<typeof VideoConfigSchema>;
