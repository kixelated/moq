import type * as Moq from "@kixelated/moq";
import { Effect, type Getter, Signal } from "@kixelated/signals";
import type * as Catalog from "../../catalog";
import * as Frame from "../../frame";
import * as Time from "../../time";
import * as Hex from "../../util/hex";
import { PRIORITY } from "../priority";
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
	supported = new Signal<Catalog.Video[]>([]);

	// The track we chose from the supported tracks.
	#selected = new Signal<Catalog.Video | undefined>(undefined);
	readonly selected: Getter<Catalog.Video | undefined> = this.#selected;

	detection: Detection;

	// Used as a tiebreaker when there are multiple tracks (HD vs SD).
	target = new Signal<Target | undefined>(undefined);

	// Unfortunately, browsers don't let us hold on to multiple VideoFrames.
	// TODO To support higher latencies, keep around the encoded data and decode on demand.
	// ex. Firefox only allows 2 outstanding VideoFrames at a time.
	// We hold a second frame buffered as a crude way to introduce latency to sync with audio.
	frame = new Signal<VideoFrame | undefined>(undefined);

	latency: Signal<Time.Milli>;

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
		this.#signals.effect(this.#init.bind(this));

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

			effect.set(this.supported, supported, []);
		});
	}

	#runSelected(effect: Effect): void {
		const supported = effect.get(this.supported);
		const target = effect.get(this.target);
		const closest = this.#selectRendition(supported, target);

		this.#selected.set(closest);
	}

	#selectRendition(renditions: Catalog.Video[], target?: Target): Catalog.Video | undefined {
		// If we have no target, then choose the largest supported rendition.
		// This is kind of a hack to use MAX_SAFE_INTEGER / 2 - 1 but IF IT WORKS, IT WORKS.
		const pixels = target?.pixels ?? Number.MAX_SAFE_INTEGER / 2 - 1;

		let closest: Catalog.Video | undefined;
		let minDistance = Number.MAX_SAFE_INTEGER;

		for (const rendition of renditions) {
			if (!rendition.config.codedHeight || !rendition.config.codedWidth) continue;

			const distance = Math.abs(pixels - rendition.config.codedHeight * rendition.config.codedWidth);
			if (distance < minDistance) {
				minDistance = distance;
				closest = rendition;
			}
		}
		if (closest) return closest;

		// If we couldn't find a closest, or there's no width/height, then choose the first supported rendition.
		return renditions.at(0);
	}

	#init(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const selected = effect.get(this.#selected);
		if (!selected) return;

		const broadcast = effect.get(this.broadcast);
		if (!broadcast) return;

		// We don't clear previous frames so we can seamlessly switch tracks.
		const sub = broadcast.subscribe(selected.track, PRIORITY.video);
		effect.cleanup(() => sub.close());

		// Create consumer that reorders groups/frames up to the provided latency.
		const consumer = new Frame.Consumer(sub, {
			latency: this.latency,
		});
		effect.cleanup(() => consumer.close());

		const decoder = new VideoDecoder({
			output: (frame) => {
				this.frame.update((prev) => {
					prev?.close();
					return frame;
				});
			},
			// TODO bubble up error
			error: (error) => {
				console.error(error);
				this.close();
			},
		});
		effect.cleanup(() => decoder.close());

		const description = selected.config.description ? Hex.toBytes(selected.config.description) : undefined;

		decoder.configure({
			...selected.config,
			description,
			optimizeForLatency: selected.config.optimizeForLatency ?? true,
		});

		effect.spawn(async () => {
			let reference: DOMHighResTimeStamp | undefined;

			for (;;) {
				const next = await consumer.decode();
				if (!next) break;

				const ref = performance.now() - Time.Milli.fromMicro(next.timestamp);
				if (!reference || ref < reference) {
					reference = ref;
				} else {
					const sleep = reference - ref + this.latency.peek();
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

	close() {
		this.frame.update((prev) => {
			prev?.close();
			return undefined;
		});

		this.#signals.close();

		this.detection.close();
	}
}
