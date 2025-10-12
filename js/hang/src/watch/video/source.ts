import type * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import type * as Catalog from "../../catalog";
import * as Frame from "../../frame";
import * as Time from "../../time";
import * as Hex from "../../util/hex";
import { Detection, type DetectionProps } from "./detection";

export type SourceProps = {
	enabled?: boolean | Signal<boolean>;
	detection?: DetectionProps;
	// Jitter buffer size in milliseconds (default: 100ms)
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

	catalog = new Signal<Catalog.Video[] | undefined>(undefined);

	// The tracks supported by our video decoder.
	#supported = new Signal<Catalog.Video[]>([]);

	// The track we chose from the supported tracks.
	#selected = new Signal<Catalog.Video | undefined>(undefined);

	// The track we're currently decoding.
	active = new Signal<Catalog.Video | undefined>(undefined);

	// The current track running, held so we can cancel it when the new track is ready.
	#pending?: Effect;
	#active?: Effect;

	detection: Detection;

	// Used as a tiebreaker when there are multiple tracks (HD vs SD).
	target = new Signal<Target | undefined>(undefined);

	// Unfortunately, browsers don't let us hold on to multiple VideoFrames.
	// TODO To support higher latencies, keep around the encoded data and decode on demand.
	// ex. Firefox only allows 2 outstanding VideoFrames at a time.
	// We hold a second frame buffered as a crude way to introduce latency to sync with audio.
	frame = new Signal<VideoFrame | undefined>(undefined);

	latency: Signal<Time.Milli>;

	// Used to convert PTS to wall time.
	#reference: DOMHighResTimeStamp | undefined;

	#signals = new Effect();

	constructor(
		broadcast: Signal<Moq.Broadcast | undefined>,
		catalog: Signal<Catalog.Root | undefined>,
		props?: SourceProps,
	) {
		this.broadcast = broadcast;
		this.latency = Signal.from(props?.latency ?? (100 as Time.Milli));
		this.enabled = Signal.from(props?.enabled ?? false);
		this.detection = new Detection(this.broadcast, catalog, props?.detection);

		this.#signals.effect(this.#runSupported.bind(this));
		this.#signals.effect(this.#runSelected.bind(this));
		this.#signals.effect(this.#runPending.bind(this));

		this.#signals.effect((effect) => {
			this.catalog.set(effect.get(catalog)?.video);
		});
	}

	#runSupported(effect: Effect): void {
		const renditions = effect.get(this.catalog) ?? [];

		effect.spawn(async () => {
			const supported: Catalog.Video[] = [];

			for (const rendition of renditions) {
				const description = rendition.config.description
					? Hex.toBytes(rendition.config.description)
					: undefined;

				const { supported: valid } = await VideoDecoder.isConfigSupported({
					...rendition.config,
					description,
					optimizeForLatency: rendition.config.optimizeForLatency ?? true,
				});
				if (valid) supported.push(rendition);
			}

			effect.set(this.#supported, supported, []);
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

			return;
		}

		// Start a new pending effect.
		this.#pending = new Effect();

		// NOTE: If the track catches up in time, it'll remove itself from #pending.
		effect.cleanup(() => this.#pending?.close());

		this.#runTrack(this.#pending, broadcast, selected);
	}

	#runTrack(effect: Effect, broadcast: Moq.Broadcast, selected: Catalog.Video): void {
		const sub = broadcast.subscribe(selected.track.name, selected.track.priority);
		effect.cleanup(() => sub.close());

		// Create consumer that reorders groups/frames up to the provided latency.
		const consumer = new Frame.Consumer(sub, {
			latency: this.latency,
		});
		effect.cleanup(() => consumer.close());

		const decoder = new VideoDecoder({
			output: (frame) => {
				// Use the previous frame if it's newer.
				const prev = this.frame.peek();
				if (prev && prev.timestamp >= frame.timestamp) {
					frame.close();
					return;
				}

				// Otherwise replace the previous frame.
				prev?.close();
				this.frame.set(frame);
			},
			// TODO bubble up error
			error: (error) => {
				console.error(error);
				effect.close();
			},
		});
		effect.cleanup(() => decoder.close());

		const description = selected.config.description ? Hex.toBytes(selected.config.description) : undefined;

		decoder.configure({
			...selected.config,
			description,
			optimizeForLatency: selected.config.optimizeForLatency ?? true,
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
					effect.set(this.active, selected);
				}

				// Sleep until it's time to decode the next frame.
				const ref = performance.now() - Time.Milli.fromMicro(next.timestamp);
				if (!this.#reference || ref < this.#reference) {
					this.#reference = ref;
				} else {
					const sleep = this.#reference - ref + this.latency.peek();
					await new Promise((resolve) => setTimeout(resolve, sleep));
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

	#selectRendition(renditions: Catalog.Video[], target?: Target): Catalog.Video | undefined {
		if (renditions.length <= 1) return renditions.at(0);

		// If we have no target, then choose the largest supported rendition.
		// This is kind of a hack to use MAX_SAFE_INTEGER / 2 - 1 but IF IT WORKS, IT WORKS.
		const pixels = target?.pixels ?? Number.MAX_SAFE_INTEGER / 2 - 1;

		// Round up to the closest rendition.
		// Also keep track of the 2nd closest, just in case there's nothing larger.

		let larger: Catalog.Video | undefined;
		let largerSize: number | undefined;

		let smaller: Catalog.Video | undefined;
		let smallerSize: number | undefined;

		for (const rendition of renditions) {
			if (!rendition.config.codedHeight || !rendition.config.codedWidth) continue;

			const size = rendition.config.codedHeight * rendition.config.codedWidth;
			if (size > pixels && (!largerSize || size < largerSize)) {
				larger = rendition;
				largerSize = size;
			} else if (size < pixels && (!smallerSize || size > smallerSize)) {
				smaller = rendition;
				smallerSize = size;
			}
		}
		if (larger) return larger;
		if (smaller) return smaller;

		console.warn("no width/height information, choosing the first supported rendition");
		return renditions.at(0);
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
