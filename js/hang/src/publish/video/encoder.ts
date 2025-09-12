import * as Moq from "@kixelated/moq";
import { Effect, type Getter, Signal } from "@kixelated/signals";
import type * as Catalog from "../../catalog";
import { u8, u53 } from "../../catalog/integers";
import * as Frame from "../../frame";
import * as Time from "../../time";
import { isFirefox } from "../../util/hacks";
import * as Hex from "../../util/hex";
import { Detection, type DetectionProps } from "./detection";
import { VideoTrackProcessor } from "./polyfill";
import type { Source, VideoTrackSettings } from "./types";

// Create a group every 2 seconds
const GOP_DURATION = Time.Micro.fromSecond(2 as Time.Second);

export type EncoderProps = {
	enabled?: boolean | Signal<boolean>;
	source?: Source | Signal<Source | undefined>;
	flip?: boolean | Signal<boolean>;
	detection?: DetectionProps;
};

export class Encoder {
	broadcast: Moq.BroadcastProducer;
	detection: Detection;

	enabled: Signal<boolean>;
	flip: Signal<boolean>;
	source: Signal<Source | undefined>;

	#catalog = new Signal<Catalog.Video | undefined>(undefined);
	readonly catalog: Getter<Catalog.Video | undefined> = this.#catalog;

	#track = new Moq.TrackProducer("video", 1);

	#active = new Signal(false);
	readonly active: Getter<boolean> = this.#active;

	#encoderConfig = new Signal<VideoEncoderConfig | undefined>(undefined);
	#decoderConfig = new Signal<VideoDecoderConfig | undefined>(undefined);

	#signals = new Effect();

	// Store the latest VideoFrame
	frame = new Signal<VideoFrame | undefined>(undefined);

	constructor(broadcast: Moq.BroadcastProducer, props?: EncoderProps) {
		this.broadcast = broadcast;
		this.detection = new Detection(this.broadcast, this.frame.peek.bind(this.frame), props?.detection);

		this.source = Signal.from(props?.source);
		this.enabled = Signal.from(props?.enabled ?? false);
		this.flip = Signal.from(props?.flip ?? false);

		this.#signals.effect(this.#runEncoder.bind(this));
		this.#signals.effect(this.#runCatalog.bind(this));
	}

	#runEncoder(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const source = effect.get(this.source);
		if (!source) return;

		// Insert the track into the broadcast.
		this.broadcast.insertTrack(this.#track.consume());
		effect.cleanup(() => this.broadcast.removeTrack(this.#track.name));

		const settings = source.getSettings() as VideoTrackSettings;
		const processor = VideoTrackProcessor(source);
		const reader = processor.getReader();
		effect.cleanup(() => reader.cancel());

		let group: Moq.GroupProducer | undefined;
		effect.cleanup(() => group?.close());

		let groupTimestamp = 0 as Time.Micro;

		const encoder = new VideoEncoder({
			output: (frame: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata) => {
				if (metadata?.decoderConfig) {
					effect.set(this.#decoderConfig, metadata.decoderConfig);
				}

				if (frame.type === "key") {
					groupTimestamp = frame.timestamp as Time.Micro;
					group?.close();
					group = this.#track.appendGroup();
				} else if (!group) {
					throw new Error("no keyframe");
				}

				const buffer = Frame.encode(frame, frame.timestamp as Time.Micro);
				group?.writeFrame(buffer);
			},
			error: (err: Error) => {
				group?.abort(err);
				this.#track.abort(err);
			},
		});
		effect.cleanup(() => encoder.close());

		effect.spawn(async (cancel) => {
			let next = await Promise.race([reader.read(), cancel]);
			if (!next || !next.value) return;

			effect.set(this.#active, true, false);

			let frame = next.value;

			const config = await Promise.race([Encoder.#bestEncoderConfig(settings, frame), cancel]);
			if (!config) return; // cancelled

			encoder.configure(config);

			effect.set(this.#encoderConfig, config);

			while (frame) {
				// Force a keyframe if this is the first frame (no group yet), or GOP elapsed.
				const keyFrame = !group || groupTimestamp + GOP_DURATION <= frame.timestamp;
				if (keyFrame) {
					groupTimestamp = frame.timestamp as Time.Micro;
				}

				this.frame.set((prev) => {
					prev?.close();
					return frame;
				});

				encoder.encode(frame, { keyFrame });

				next = await Promise.race([reader.read(), cancel]);
				if (!next || !next.value) return;

				frame = next.value;
			}
		});
	}

	// Try to determine the best config for the given settings.
	static async #bestEncoderConfig(settings: VideoTrackSettings, frame: VideoFrame): Promise<VideoEncoderConfig> {
		const width = frame.codedWidth;
		const height = frame.codedHeight;
		const framerate = settings.frameRate;

		console.debug("determining best encoder config for: ", {
			width,
			height,
			framerate,
		});

		// TARGET BITRATE CALCULATION (h264)
		// 480p@30 = 1.0mbps
		// 480p@60 = 1.5mbps
		// 720p@30 = 2.5mbps
		// 720p@60 = 3.5mpbs
		// 1080p@30 = 4.5mbps
		// 1080p@60 = 6.0mbps
		const pixels = width * height;

		// 30fps is the baseline, applying a multiplier for higher framerates.
		// Framerate does not cause a multiplicative increase in bitrate because of delta encoding.
		// TODO Make this better.
		const framerateFactor = 30.0 + (framerate - 30) / 2;
		const bitrate = Math.round(pixels * 0.07 * framerateFactor);

		// ACTUAL BITRATE CALCULATION
		// 480p@30 = 409920 * 30 * 0.07 = 0.9 Mb/s
		// 480p@60 = 409920 * 45 * 0.07 = 1.3 Mb/s
		// 720p@30 = 921600 * 30 * 0.07 = 1.9 Mb/s
		// 720p@60 = 921600 * 45 * 0.07 = 2.9 Mb/s
		// 1080p@30 = 2073600 * 30 * 0.07 = 4.4 Mb/s
		// 1080p@60 = 2073600 * 45 * 0.07 = 6.5 Mb/s

		// A list of codecs to try, in order of preference.
		const HARDWARE_CODECS = [
			// VP9
			// More likely to have hardware decoding, but hardware encoding is less likely.
			"vp09.00.10.08",
			"vp09", // Browser's choice

			// H.264
			// Almost always has hardware encoding and decoding.
			"avc1.640028",
			"avc1.4D401F",
			"avc1.42E01E",
			"avc1",

			// AV1
			// One day will get moved higher up the list, but hardware decoding is rare.
			"av01.0.08M.08",
			"av01",

			// HEVC (aka h.265)
			// More likely to have hardware encoding, but less likely to be supported (licensing issues).
			// Unfortunately, Firefox doesn't support decoding so it's down here at the bottom.
			"hev1.1.6.L93.B0",
			"hev1", // Browser's choice

			// VP8
			// A terrible codec but it's easy.
			"vp8",
		];

		const SOFTWARE_CODECS = [
			// Now try software encoding for simple enough codecs.
			// H.264
			"avc1.640028", // High
			"avc1.4D401F", // Main
			"avc1.42E01E", // Baseline
			"avc1",

			// VP8
			"vp8",

			// VP9
			// It's a bit more expensive to encode so we shy away from it.
			"vp09.00.10.08",
			"vp09",

			// HEVC (aka h.265)
			// This likely won't work because of licensing issues.
			"hev1.1.6.L93.B0",
			"hev1", // Browser's choice

			// AV1
			// Super expensive to encode so it's our last choice.
			"av01.0.08M.08",
			"av01",
		];

		const baseConfig: VideoEncoderConfig = {
			codec: "none",
			width,
			height,
			bitrate,
			latencyMode: "realtime",
			framerate,
		};

		// Try hardware encoding first.
		// We can't reliably detect hardware encoding on Firefox: https://github.com/w3c/webcodecs/issues/896
		if (!isFirefox) {
			for (const codec of HARDWARE_CODECS) {
				const config = Encoder.#codecSpecific(baseConfig, codec, bitrate, true);
				const { supported, config: hardwareConfig } = await VideoEncoder.isConfigSupported(config);
				if (supported && hardwareConfig) {
					console.debug("using hardware encoding: ", hardwareConfig);
					return hardwareConfig;
				}
			}
		} else {
			console.warn("Cannot detect hardware encoding on Firefox.");
		}

		// Try software encoding.
		for (const codec of SOFTWARE_CODECS) {
			const config = Encoder.#codecSpecific(baseConfig, codec, bitrate, false);
			const { supported, config: softwareConfig } = await VideoEncoder.isConfigSupported(config);
			if (supported && softwareConfig) {
				console.debug("using software encoding: ", softwareConfig);
				return softwareConfig;
			}
		}

		throw new Error("no supported codec");
	}

	// Modify the config for codec specific settings.
	static #codecSpecific(
		base: VideoEncoderConfig,
		codec: string,
		bitrate: number,
		hardware: boolean,
	): VideoEncoderConfig {
		const config: VideoEncoderConfig = {
			...base,
			codec,
			hardwareAcceleration: hardware ? "prefer-hardware" : undefined,
		};

		// We scale the bitrate for more efficient codecs.
		// TODO This shouldn't be linear, as the efficiency is very similar at low bitrates.
		if (config.codec.startsWith("avc1")) {
			// Annex-B allows changing the resolution without nessisarily updating the catalog (description).
			config.avc = { format: "annexb" };
		} else if (config.codec.startsWith("hev1")) {
			// Annex-B allows changing the resolution without nessisarily updating the catalog (description).
			// @ts-expect-error Typescript needs to be updated.
			config.hevc = { format: "annexb" };
		} else if (config.codec.startsWith("vp09")) {
			config.bitrate = bitrate * 0.8;
		} else if (config.codec.startsWith("av01")) {
			config.bitrate = bitrate * 0.6;
		} else if (config.codec === "vp8") {
			// Worse than H.264 but it's a backup plan.
			config.bitrate = bitrate * 1.1;
		}

		return config;
	}

	// Returns the catalog for the configured settings.
	#runCatalog(effect: Effect): void {
		const encoderConfig = effect.get(this.#encoderConfig);
		if (!encoderConfig) return;

		const decoderConfig = effect.get(this.#decoderConfig);
		if (!decoderConfig) return;

		const flip = effect.get(this.flip);

		const description = decoderConfig.description
			? Hex.fromBytes(decoderConfig.description as Uint8Array)
			: undefined;

		const catalog: Catalog.Video = {
			track: {
				name: this.#track.name,
				priority: u8(this.#track.priority),
			},
			config: {
				// The order is important here.
				codec: decoderConfig.codec,
				description,
				codedWidth: decoderConfig.codedWidth ? u53(decoderConfig.codedWidth) : undefined,
				codedHeight: decoderConfig.codedHeight ? u53(decoderConfig.codedHeight) : undefined,
				displayAspectWidth: encoderConfig.displayWidth ? u53(encoderConfig.displayWidth) : undefined,
				displayAspectHeight: encoderConfig.displayHeight ? u53(encoderConfig.displayHeight) : undefined,
				framerate: encoderConfig.framerate,
				bitrate: encoderConfig.bitrate ? u53(encoderConfig.bitrate) : undefined,
				optimizeForLatency: decoderConfig.optimizeForLatency,
				flip,
				rotation: undefined,
			},
		};

		effect.set(this.#catalog, catalog);
	}

	close() {
		this.frame.set((prev) => {
			prev?.close();
			return undefined;
		});

		this.#signals.close();
		this.detection.close();
		this.#track.close();
	}
}
