import * as Moq from "@kixelated/moq";
import { Effect, type Getter, Signal } from "@kixelated/signals";
import * as Catalog from "../../catalog";
import { u53 } from "../../catalog";
import * as Frame from "../../frame";
import * as Time from "../../time";
import { isFirefox } from "../../util/hacks";
import { Detection, type DetectionProps } from "./detection";
import { VideoTrackProcessor } from "./polyfill";
import type { Source, VideoStreamTrack } from "./types";

// Create a group every 2 seconds
const GOP_DURATION = Time.Micro.fromSecond(2 as Time.Second);

export type EncoderProps = {
	enabled?: boolean | Signal<boolean>;
	source?: Source | Signal<Source | undefined>;
	flip?: boolean | Signal<boolean>;
	detection?: DetectionProps;
};

export class Encoder {
	static readonly TRACK = "video/data";
	detection: Detection;

	enabled: Signal<boolean>;
	flip: Signal<boolean>;
	source: Signal<Source | undefined>;
	codec = new Signal<string | undefined>(undefined);

	#catalog = new Signal<Catalog.Video | undefined>(undefined);
	readonly catalog: Getter<Catalog.Video | undefined> = this.#catalog;

	#signals = new Effect();

	// Store the latest VideoFrame
	frame = new Signal<VideoFrame | undefined>(undefined);

	constructor(props?: EncoderProps) {
		this.detection = new Detection(this.frame.peek.bind(this.frame), props?.detection);

		this.source = Signal.from(props?.source);
		this.enabled = Signal.from(props?.enabled ?? false);
		this.flip = Signal.from(props?.flip ?? false);

		bestCodec().then(this.codec.set.bind(this.codec));

		this.#signals.effect(this.#runCatalog.bind(this));
		this.#signals.effect(this.#runFrame.bind(this));
	}

	#runFrame(effect: Effect): void {
		const source = effect.get(this.source);
		if (!source) return;

		const processor = VideoTrackProcessor(source);
		const reader = processor.getReader();
		effect.cleanup(() => reader.cancel());

		effect.spawn(async () => {
			for (;;) {
				const next = await reader.read();
				if (!next || !next.value) return;

				this.frame.update((prev) => {
					prev?.close();
					return next.value;
				});
			}
		});

		effect.cleanup(() => {
			this.frame.update((prev) => {
				prev?.close();
				return undefined;
			});
		});
	}

	serve(track: Moq.Track, effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const source = effect.get(this.source);
		if (!source) return;

		const codec = effect.get(this.codec);
		if (!codec) return;

		effect.spawn(this.#runEncoder.bind(this, track, codec, source, effect));
	}

	async #runEncoder(track: Moq.Track, codec: string, source: VideoStreamTrack, effect: Effect): Promise<void> {
		const settings = source.getSettings();

		let group: Moq.Group | undefined; // TODO close
		effect.cleanup(() => group?.close());

		let groupTimestamp = 0 as Time.Micro;

		const encoder = new VideoEncoder({
			output: (frame: EncodedVideoChunk) => {
				if (frame.type === "key") {
					groupTimestamp = frame.timestamp as Time.Micro;
					group?.close();
					group = track.appendGroup();
				} else if (!group) {
					throw new Error("no keyframe");
				}

				const buffer = Frame.encode(frame, frame.timestamp as Time.Micro);
				group?.writeFrame(buffer);
			},
			error: (err: Error) => {
				group?.close(err);
			},
		});

		effect.cleanup(() => encoder.close());

		let width: number | undefined;
		let height: number | undefined;

		effect.effect((effect) => {
			const frame = effect.get(this.frame);
			if (!frame) return;

			if (frame.codedWidth !== width || frame.codedHeight !== height) {
				width = frame.codedWidth;
				height = frame.codedHeight;

				const bitrate = bestBitrate({
					codec,
					width,
					height,
					framerate: settings.frameRate,
				});

				const config: VideoEncoderConfig = {
					codec,
					width,
					height,
					framerate: settings.frameRate,
					bitrate,
					avc: codec.startsWith("avc1") ? { format: "annexb" } : undefined,
					// @ts-expect-error Typescript needs to be updated.
					hevc: codec.startsWith("hev1") ? { format: "annexb" } : undefined,
					latencyMode: "realtime",
					hardwareAcceleration: "prefer-hardware",
				};
				console.debug("encoding video", config);
				encoder.configure(config);
			}

			// Force a keyframe if this is the first frame (no group yet), or GOP elapsed.
			const keyFrame = !group || groupTimestamp + GOP_DURATION <= frame.timestamp;
			if (keyFrame) {
				groupTimestamp = frame.timestamp as Time.Micro;
			}

			encoder.encode(frame, { keyFrame });
		});
	}

	// Returns the catalog for the configured settings.
	#runCatalog(effect: Effect): void {
		const source = effect.get(this.source);
		if (!source) return;

		const codec = effect.get(this.codec);
		if (!codec) return;

		// NOTE: These settings are notoriously unreliable and do not update.
		// We only guestimate the bitrate but it may be updated in real-time.
		const settings = source.getSettings();
		const bitrate = bestBitrate({
			codec,
			width: settings.width,
			height: settings.height,
			framerate: settings.frameRate,
		});

		const flip = effect.get(this.flip);

		const catalog: Catalog.Video = {
			track: Encoder.TRACK,
			config: {
				codec,
				flip,

				bitrate: u53(bitrate),
				displayAspectWidth: u53(settings.width),
				displayAspectHeight: u53(settings.height),

				framerate: settings.frameRate,
			},
		};

		effect.set(this.#catalog, catalog);
	}

	close() {
		this.frame.update((prev) => {
			prev?.close();
			return undefined;
		});

		this.#signals.close();
		this.detection.close();
	}
}

function bestBitrate(props: { codec: string; width: number; height: number; framerate?: number }): number {
	// TARGET BITRATE CALCULATION (h264)
	// 480p@30 = 1.0mbps
	// 480p@60 = 1.5mbps
	// 720p@30 = 2.5mbps
	// 720p@60 = 3.5mpbs
	// 1080p@30 = 4.5mbps
	// 1080p@60 = 6.0mbps
	const pixels = props.width * props.height;

	// 30fps is the baseline, applying a multiplier for higher framerates.
	// Framerate does not cause a multiplicative increase in bitrate because of delta encoding.
	// TODO Make this better.
	const framerateFactor = 30.0 + (props.framerate ?? 30 - 30) / 2;
	let bitrate = Math.round(pixels * 0.07 * framerateFactor);

	// ACTUAL BITRATE CALCULATION
	// 480p@30 = 409920 * 30 * 0.07 = 0.9 Mb/s
	// 480p@60 = 409920 * 45 * 0.07 = 1.3 Mb/s
	// 720p@30 = 921600 * 30 * 0.07 = 1.9 Mb/s
	// 720p@60 = 921600 * 45 * 0.07 = 2.9 Mb/s
	// 1080p@30 = 2073600 * 30 * 0.07 = 4.4 Mb/s
	// 1080p@60 = 2073600 * 45 * 0.07 = 6.5 Mb/s

	// We scale the bitrate for more efficient codecs.
	// TODO This shouldn't be linear, as the efficiency is very similar at low bitrates.
	if (props.codec.startsWith("avc1")) {
		bitrate *= 1.0; // noop
	} else if (props.codec.startsWith("hev1")) {
		bitrate *= 0.7;
	} else if (props.codec.startsWith("vp09")) {
		bitrate *= 0.8;
	} else if (props.codec.startsWith("av01")) {
		bitrate *= 0.6;
	} else if (props.codec === "vp8") {
		// Worse than H.264 but it's a backup plan.
		bitrate *= 1.1;
	} else {
		throw new Error(`unknown codec: ${props.codec}`);
	}

	return bitrate;
}

// Try to determine the best config for the given settings.
async function bestCodec(): Promise<string> {
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

	// Try hardware encoding first.
	// We can't reliably detect hardware encoding on Firefox: https://github.com/w3c/webcodecs/issues/896
	if (!isFirefox) {
		for (const codec of HARDWARE_CODECS) {
			const config: VideoEncoderConfig = {
				codec,
				width: 1280,
				height: 720,
				latencyMode: "realtime",
				hardwareAcceleration: "prefer-hardware",
				avc: codec.startsWith("avc1") ? { format: "annexb" } : undefined,
				// @ts-expect-error Typescript needs to be updated.
				hevc: codec.startsWith("hev1") ? { format: "annexb" } : undefined,
			};

			const { supported, config: hardwareConfig } = await VideoEncoder.isConfigSupported(config);
			if (supported && hardwareConfig) {
				return codec;
			}
		}
	} else {
		console.warn("Cannot detect hardware encoding on Firefox.");
	}

	// Try software encoding.
	for (const codec of SOFTWARE_CODECS) {
		const config: VideoEncoderConfig = {
			codec,
			width: 1280,
			height: 720,
			latencyMode: "realtime",
			hardwareAcceleration: "prefer-software",
		};

		const { supported, config: softwareConfig } = await VideoEncoder.isConfigSupported(config);
		if (supported && softwareConfig) {
			return codec;
		}
	}

	throw new Error("no supported codec");
}
