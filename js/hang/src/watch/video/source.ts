import * as Moq from "@kixelated/moq";
import { Effect, type Getter, Signal } from "@kixelated/signals";
import * as Catalog from "../../catalog";
import * as Frame from "../../frame";
import * as Hex from "../../util/hex";
import { PRIORITY } from "../priority";
import { Detection, type DetectionProps } from "./detection";

export type SourceProps = {
	enabled?: boolean | Signal<boolean>;
	detection?: DetectionProps;
};

// Responsible for switching between video tracks and buffering frames.
export class Source {
	broadcast: Signal<Moq.Broadcast | undefined>;
	enabled: Signal<boolean>; // Don't download any longer

	catalog = new Signal<Catalog.Video | undefined>(undefined);

	// Helper that is populated from the catalog.
	#config = new Signal<Catalog.VideoConfig | undefined>(undefined);
	readonly config: Getter<Catalog.VideoConfig | undefined> = this.#config;

	// The tracks supported by our video decoder.
	#supported = new Signal<Record<Catalog.Track, Catalog.VideoConfig>>({});

	// The track we chose from the supported tracks.
	#selected = new Signal<[Catalog.Track, Catalog.VideoConfig] | undefined>(undefined);

	detection: Detection;

	// The desired size of the video in pixels.
	// Used as a tiebreaker when there are multiple tracks (HD vs SD).
	targetPixels = new Signal<number | undefined>(undefined);

	// Unfortunately, browsers don't let us hold on to multiple VideoFrames.
	// TODO To support higher latencies, keep around the encoded data and decode on demand.
	// ex. Firefox only allows 2 outstanding VideoFrames at a time.
	// We hold a second frame buffered as a crude way to introduce latency to sync with audio.
	frame = new Signal<VideoFrame | undefined>(undefined);
	#next?: VideoFrame;

	#signals = new Effect();

	constructor(
		broadcast: Signal<Moq.Broadcast | undefined>,
		catalog: Signal<Catalog.Root | undefined>,
		props?: SourceProps,
	) {
		this.broadcast = broadcast;
		this.enabled = Signal.from(props?.enabled ?? false);
		this.detection = new Detection(this.broadcast, this.catalog, props?.detection);

		this.#signals.effect(this.#runSupported.bind(this));
		this.#signals.effect(this.#runSelected.bind(this));
		this.#signals.effect(this.#init.bind(this));

		this.#signals.effect((effect) => {
			this.catalog.set(effect.get(catalog)?.video);
		});
	}

	#runSupported(effect: Effect): void {
		const available = effect.get(this.catalog)?.tracks ?? {};

		effect.spawn(async () => {
			const supported: Record<Catalog.Track, Catalog.VideoConfig> = {};

			for (const [track, config] of Object.entries(available)) {
				const description = config.description ? Hex.toBytes(config.description) : undefined;

				const { supported: valid } = await VideoDecoder.isConfigSupported({
					...config,
					description,
					optimizeForLatency: config.optimizeForLatency ?? true,
				});
				if (valid) supported[track] = config;
			}

			console.log("setting supported", supported);

			effect.set(this.#supported, supported, {});
		});
	}

	#runSelected(effect: Effect): void {
		const supported = effect.get(this.#supported);
		const requested = effect.get(this.targetPixels);
		const closest = this.#selectRendition(supported, requested);

		this.#selected.set(closest);
		this.#config.set(closest?.[1]);
	}

	#selectRendition(
		supported: Record<Catalog.Track, Catalog.VideoConfig>,
		targetPixels?: number,
	): [Catalog.Track, Catalog.VideoConfig] | undefined {
		// If we have no target, then choose the largest supported rendition.
		// This is kind of a hack to use MAX_SAFE_INTEGER / 2 - 1 but IF IT WORKS, IT WORKS.
		if (!targetPixels) targetPixels = Number.MAX_SAFE_INTEGER / 2 - 1;

		let closest: [Catalog.Track, Catalog.VideoConfig] | undefined;
		let minDistance = Number.MAX_SAFE_INTEGER;

		for (const [track, config] of Object.entries(supported)) {
			if (!config.codedHeight || !config.codedWidth) continue;

			const distance = Math.abs(targetPixels - config.codedHeight * config.codedWidth);
			if (distance < minDistance) {
				minDistance = distance;
				closest = [track, config];
			}
		}
		if (closest) return closest;

		// If we couldn't find a closest, or there's no width/height, then choose the first supported rendition.
		return Object.entries(supported).at(0);
	}

	#init(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const selected = effect.get(this.#selected);
		if (!selected) return;

		const broadcast = effect.get(this.broadcast);
		if (!broadcast) return;

		const [track, config] = selected;

		// We don't clear previous frames so we can seamlessly switch tracks.
		const sub = broadcast.subscribe(track, PRIORITY.video);
		effect.cleanup(() => sub.close());

		const decoder = new VideoDecoder({
			output: (frame) => {
				if (!this.frame.peek()) {
					this.frame.set(frame);
					return;
				}

				if (!this.#next) {
					this.#next = frame;
					return;
				}

				this.frame.update((prev) => {
					prev?.close();
					return this.#next;
				});

				this.#next = frame;
			},
			// TODO bubble up error
			error: (error) => {
				console.error(error);
				this.close();
			},
		});
		effect.cleanup(() => decoder.close());

		const description = config.description ? Hex.toBytes(config.description) : undefined;

		decoder.configure({
			...config,
			description,
			optimizeForLatency: config.optimizeForLatency ?? true,
		});

		effect.spawn(async () => {
			for (;;) {
				const next = await sub.readFrameSequence();
				if (!next) break;

				const decoded = Frame.decode(next.data);

				const chunk = new EncodedVideoChunk({
					type: next.frame === 0 ? "key" : "delta",
					data: decoded.data,
					timestamp: decoded.timestamp,
				});

				decoder.decode(chunk);
			}
		});

		effect.cleanup(() => {
			this.frame.update((frame) => {
				frame?.close();
				return undefined;
			});

			this.#next?.close();
			this.#next = undefined;
		});
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
