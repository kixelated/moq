import { z } from "zod";
import { u53Schema } from "../integers";
import { TrackSchema } from "../track";
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

/// A single audio rendition, including the track and config.
/// TODO Add language.
export const AudioRenditionSchema = z.object({
	track: TrackSchema,
	config: AudioConfigSchema,
});

export const AudioSchema = z.object({
	// Each audio track available.
	renditions: z.array(AudioRenditionSchema),

	// The MoQ track information.
	// TODO This should be part of renditions right?
	captions: CaptionsSchema.optional(),

	// An optional speaking track.
	speaking: SpeakingSchema.optional(),
});

export type Audio = z.infer<typeof AudioSchema>;
export type AudioConfig = z.infer<typeof AudioConfigSchema>;
export type AudioRendition = z.infer<typeof AudioRenditionSchema>;
