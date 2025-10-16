import { z } from "zod";
import { u53Schema } from "../integers";
import { CaptionsSchema } from "./captions";
import { SpeakingSchema } from "./speaking";

// Mirrors AudioDecoderConfig
// https://w3c.github.io/webcodecs/#audio-decoder-config
export const AudioConfigSchema = z.object({
	// See: https://w3c.github.io/webcodecs/codec_registry.html
	codec: z.string(),

	// The description is used for some codecs.
	// If provided, we can initialize the decoder based on the catalog alone.
	// Otherwise, the initialization information is in-band.
	description: z.string().optional(), // hex encoded TODO use base64

	// The sample rate of the audio in Hz
	sampleRate: u53Schema,

	// The number of channels in the audio
	numberOfChannels: u53Schema,

	// The bitrate of the audio in bits per second
	// TODO: Support up to Number.MAX_SAFE_INTEGER
	bitrate: u53Schema.optional(),
});

export const AudioSchema = z.object({
	// A map of track name to rendition configuration.
	// This is not an array so it will work with JSON Merge Patch.
	renditions: z.record(z.string(), AudioConfigSchema),

	// The priority of the audio track, relative to other tracks in the broadcast.
	priority: z.number().int().min(0).max(255),

	// An optional captions track
	captions: CaptionsSchema.optional(),

	// An optional speaking track
	speaking: SpeakingSchema.optional(),
});

export type Audio = z.infer<typeof AudioSchema>;
export type AudioConfig = z.infer<typeof AudioConfigSchema>;
