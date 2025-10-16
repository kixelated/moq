import type * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import type * as Catalog from "../../catalog";
import * as Frame from "../../frame";
import { PRIORITY } from "../../publish/priority";
import * as Time from "../../time";
import * as Hex from "../../util/hex";
import { Detection, type DetectionProps } from "./detection";

export type SourceProps = {
	enabled?: boolean | Signal<boolean>;
	detection?: DetectionProps;

	// Jitter buffer size in milliseconds (default: 100ms)
	// When using b-frames, this should to be larger than the frame duration.
	latency?: Time.Milli | Signal<Time.Milli>;
};

export type Target = {
	// The desired size of the video in pixels.
	pixels?: number;

	// TODO bitrate
};

// Responsible for switching between video tracks and buffering frames.
export class Source {
	broadcast: Signal<Moq.Broadcast | undefined>;
	enabled: Signal<boolean>; // Don't download any longer

	catalog = new Signal<Catalog.Video | undefined>(undefined);

	// The tracks supported by our video decoder.
	#supported = new Signal<Record<string, Catalog.VideoConfig>>({});

	// The track we chose from the supported tracks.
	#selected = new Signal<[string, Catalog.VideoConfig] | undefined>(undefined);

	// The name of the active rendition.
	active = new Signal<string | undefined>(undefined);

	// The current track running, held so we can cancel it when the new track is ready.
	#pending?: Effect;
	#active?: Effect;

	detection: Detection;

	// Used as a tiebreaker when there are multiple tracks (HD vs SD).
	target = new Signal<Target | undefined>(undefined);

	// Unfortunately, browsers don't let us hold on to multiple VideoFrames.
	// ex. Firefox only allows 2 outstanding VideoFrames at a time.
	// In order to semi-support b-frames, we buffer two frames and expose the earliest one.
	frame = new Signal<VideoFrame | undefined>(undefined);
	#next?: VideoFrame;

	latency: Signal<Time.Milli>;

	// The display size of the video in pixels, ideally sourced from the catalog.
	display = new Signal<{ width: number; height: number } | undefined>(undefined);

	// Whether to flip the video horizontally.
	flip = new Signal<boolean | undefined>(undefined);

	// Used to convert PTS to wall time.
	#reference: DOMHighResTimeStamp | undefined;

	// The latency after we've accounted for the extra frame buffering and jitter buffer.
	#jitter: Signal<Time.Milli>;

	#signals = new Effect();

	constructor(
		broadcast: Signal<Moq.Broadcast | undefined>,
		catalog: Signal<Catalog.Root | undefined>,
		props?: SourceProps,
	) {
		this.broadcast = broadcast;
		this.latency = Signal.from(props?.latency ?? (100 as Time.Milli));
		this.enabled = Signal.from(props?.enabled ?? false);
		this.detection = new Detection(this.broadcast, this.catalog, props?.detection);

		// We subtract a frame from the jitter buffer to account for the extra buffered frame.
		// Assume 30fps by default.
		this.#jitter = new Signal(Math.max(0, this.latency.peek() - 33) as Time.Milli);

		this.#signals.effect((effect) => {
			const c = effect.get(catalog)?.video;
			effect.set(this.catalog, c);
			effect.set(this.flip, c?.flip);
		});

		this.#signals.effect(this.#runSupported.bind(this));
		this.#signals.effect(this.#runSelected.bind(this));
		this.#signals.effect(this.#runPending.bind(this));
		this.#signals.effect(this.#runDisplay.bind(this));
		this.#signals.effect(this.#runJitter.bind(this));
	}

	#runSupported(effect: Effect): void {
		const renditions = effect.get(this.catalog)?.renditions ?? {};

		effect.spawn(async () => {
			const supported: Record<string, Catalog.VideoConfig> = {};

			for (const [name, rendition] of Object.entries(renditions)) {
				const description = rendition.description ? Hex.toBytes(rendition.description) : undefined;

				const { supported: valid } = await VideoDecoder.isConfigSupported({
					...rendition,
					description,
					optimizeForLatency: rendition.optimizeForLatency ?? true,
				});
				if (valid) supported[name] = rendition;
			}

			this.#supported.set(supported);
		});
	}

	#runSelected(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const supported = effect.get(this.#supported);
		const target = effect.get(this.target);

		const selected = this.#selectRendition(supported, target);
		if (!selected) return;

		effect.set(this.#selected, selected);
	}

	#runPending(effect: Effect): void {
		const broadcast = effect.get(this.broadcast);
		const selected = effect.get(this.#selected);
		const enabled = effect.get(this.enabled);

		if (!broadcast || !selected || !enabled) {
			// Stop the active track.
			this.#active?.close();
			this.#active = undefined;

			this.frame.update((prev) => {
				prev?.close();
				return undefined;
			});

			this.#next?.close();
			this.#next = undefined;

			return;
		}

		// Start a new pending effect.
		this.#pending = new Effect();

		// NOTE: If the track catches up in time, it'll remove itself from #pending.
		effect.cleanup(() => this.#pending?.close());

		this.#runTrack(this.#pending, broadcast, selected[0], selected[1]);
	}

	#runTrack(effect: Effect, broadcast: Moq.Broadcast, name: string, config: Catalog.VideoConfig): void {
		const sub = broadcast.subscribe(name, PRIORITY.video); // TODO use priority from catalog
		effect.cleanup(() => sub.close());

		// Create consumer that reorders groups/frames up to the provided latency.
		const consumer = new Frame.Consumer(sub, {
			latency: this.#jitter,
		});
		effect.cleanup(() => consumer.close());

		const decoder = new VideoDecoder({
			output: (frame) => {
				// Keep track of the two newest frames.
				// this.frame is older than this.#next, if it exists.
				const prev = this.frame.peek();
				if (prev && prev.timestamp >= frame.timestamp) {
					// NOTE: This can happen if you have more than 1 b-frame in a row.
					// Sorry, blame Firefox.
					frame.close();
					return;
				}

				if (!prev) {
					// As time-to-video optimization, use the first frame we see.
					// We know this is an i-frame so there's no need to re-order it.
					this.frame.set(frame);
					return;
				}

				// If jitter is 0, then we disable buffering frames.
				const jitter = this.#jitter.peek();
				if (jitter === 0) {
					prev.close();
					this.frame.set(frame);
					return;
				}

				if (!this.#next) {
					// We know we're newer than the current frame, so buffer it.
					this.#next = frame;
					return;
				}

				// Close the previous frame, and check if we need to replace #next or this.frame.
				prev.close();

				if (this.#next.timestamp < frame.timestamp) {
					// Replace #next with the new frame.
					this.frame.set(this.#next);
					this.#next = frame;
				} else {
					// #next is newer than this new frame, so keep it.
					this.frame.set(frame);
				}
			},
			// TODO bubble up error
			error: (error) => {
				console.error(error);
				effect.close();
			},
		});
		effect.cleanup(() => decoder.close());

		const description = config.description ? Hex.toBytes(config.description) : undefined;

		decoder.configure({
			...config,
			description,
			optimizeForLatency: config.optimizeForLatency ?? true,
			// @ts-expect-error Only supported by Chrome, so the renderer has to flip manually.
			flip: false,
		});

		effect.spawn(async () => {
			for (;;) {
				const next = await Promise.race([consumer.decode(), effect.cancel]);
				if (!next) break;

				// See if we can upgrade ourselves to the active track once we catch up.
				// TODO: This is a racey when latency === 0, but I think it's fine.
				const prev = this.frame.peek();
				if (this.#pending === effect && (!prev || next.timestamp > prev.timestamp)) {
					this.#active?.close();
					this.#active = effect;
					this.#pending = undefined;
					effect.set(this.active, name);
				}

				// Sleep until it's time to decode the next frame.
				const ref = performance.now() - Time.Milli.fromMicro(next.timestamp);

				if (!this.#reference || ref < this.#reference) {
					this.#reference = ref;
				} else {
					const sleep = this.#reference - ref + this.#jitter.peek();
					if (sleep > 0) {
						await new Promise((resolve) => setTimeout(resolve, sleep));
					}
				}

				if (decoder.state === "closed") {
					// Closed during the sleep
					break;
				}

				const chunk = new EncodedVideoChunk({
					type: next.keyframe ? "key" : "delta",
					data: next.data,
					timestamp: next.timestamp,
				});

				decoder.decode(chunk);
			}
		});
	}

	#selectRendition(
		renditions: Record<string, Catalog.VideoConfig>,
		target?: Target,
	): [string, Catalog.VideoConfig] | undefined {
		const entries = Object.entries(renditions);
		if (entries.length <= 1) return entries.at(0);

		// If we have no target, then choose the largest supported rendition.
		// This is kind of a hack to use MAX_SAFE_INTEGER / 2 - 1 but IF IT WORKS, IT WORKS.
		const pixels = target?.pixels ?? Number.MAX_SAFE_INTEGER / 2 - 1;

		// Round up to the closest rendition.
		// Also keep track of the 2nd closest, just in case there's nothing larger.

		let larger: [string, Catalog.VideoConfig] | undefined;
		let largerSize: number | undefined;

		let smaller: [string, Catalog.VideoConfig] | undefined;
		let smallerSize: number | undefined;

		for (const [name, rendition] of entries) {
			if (!rendition.codedHeight || !rendition.codedWidth) continue;

			const size = rendition.codedHeight * rendition.codedWidth;
			if (size > pixels && (!largerSize || size < largerSize)) {
				larger = [name, rendition];
				largerSize = size;
			} else if (size < pixels && (!smallerSize || size > smallerSize)) {
				smaller = [name, rendition];
				smallerSize = size;
			}
		}
		if (larger) return larger;
		if (smaller) return smaller;

		console.warn("no width/height information, choosing the first supported rendition");
		return entries.at(0);
	}

	#runDisplay(effect: Effect): void {
		const catalog = effect.get(this.catalog);
		if (!catalog) return;

		const display = catalog.display;
		if (display) {
			effect.set(this.display, {
				width: display.width,
				height: display.height,
			});
			return;
		}

		const frame = effect.get(this.frame);
		if (!frame) return;

		effect.set(this.display, {
			width: frame.displayWidth,
			height: frame.displayHeight,
		});
	}

	#runJitter(effect: Effect): void {
		const selected = effect.get(this.#selected);
		if (!selected) return;

		// Use the framerate to compute the jitter buffer size.
		// We always buffer a single frame, so subtract that from the jitter buffer.
		const delay = 1000 / (selected[1].framerate ?? 30);
		const latency = effect.get(this.latency);

		const jitter = Math.max(0, latency - delay) as Time.Milli;
		this.#jitter.set(jitter);

		// If we're not buffering any frames, then close the next frame.
		if (jitter === 0 && this.#next) {
			this.#next.close();
			this.#next = undefined;
		}
	}

	close() {
		this.frame.update((prev) => {
			prev?.close();
			return undefined;
		});

		this.#next?.close();
		this.#next = undefined;

		this.#signals.close();
		this.detection.close();
	}
}
