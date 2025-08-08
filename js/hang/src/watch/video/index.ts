import type * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import { Buffer } from "buffer";
import type * as Catalog from "../../catalog";
import * as Container from "../../container";
import { Detection, type DetectionProps } from "./detection";

export * from "./detection";
export * from "./renderer";

export type VideoProps = {
	enabled?: boolean;
	detection?: DetectionProps;
};

// Responsible for switching between video tracks and buffering frames.
export class Video {
	broadcast: Signal<Moq.BroadcastConsumer | undefined>;
	enabled: Signal<boolean>; // Don't download any longer
	catalog: Signal<Catalog.Root | undefined>;
	selected = new Signal<Catalog.Video | undefined>(undefined);
	active = new Signal<boolean>(false);

	detection: Detection;

	// Unfortunately, browsers don't let us hold on to multiple VideoFrames.
	// TODO To support higher latencies, keep around the encoded data and decode on demand.
	// ex. Firefox only allows 2 outstanding VideoFrames at a time.
	// We hold a second frame buffered as a crude way to introduce latency to sync with audio.
	frame = new Signal<VideoFrame | undefined>(undefined);
	#next?: VideoFrame;

	#signals = new Effect();

	constructor(
		broadcast: Signal<Moq.BroadcastConsumer | undefined>,
		catalog: Signal<Catalog.Root | undefined>,
		props?: VideoProps,
	) {
		this.broadcast = broadcast;
		this.catalog = catalog;
		this.enabled = new Signal(props?.enabled ?? false);
		this.detection = new Detection(this.broadcast, this.catalog, props?.detection);

		// TODO use isConfigSupported
		this.#signals.effect((effect) => {
			const selected = effect.get(this.catalog)?.video?.[0];
			this.selected.set(selected);
			this.active.set(selected !== undefined);
		});

		this.#signals.effect(this.#init.bind(this));
	}

	#init(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const selected = effect.get(this.selected);
		if (!selected) return;

		const broadcast = effect.get(this.broadcast);
		if (!broadcast) return;

		// We don't clear previous frames so we can seamlessly switch tracks.
		const sub = broadcast.subscribe(selected.track.name, selected.track.priority);
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

				this.frame.set((prev) => {
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

		const config = selected.config;

		decoder.configure({
			...config,
			description: config.description ? Buffer.from(config.description, "hex") : undefined,
			optimizeForLatency: config.optimizeForLatency ?? true,
		});

		effect.spawn(async (cancel) => {
			try {
				for (;;) {
					const next = await Promise.race([sub.nextFrame(), cancel]);
					if (!next) break;

					const decoded = Container.decodeFrame(next.data);

					const chunk = new EncodedVideoChunk({
						type: next.frame === 0 ? "key" : "delta",
						data: decoded.data,
						timestamp: decoded.timestamp,
					});

					decoder.decode(chunk);
				}
			} catch (error) {
				console.warn("video subscription error", error);
			}
		});
	}

	close() {
		this.frame.set((prev) => {
			prev?.close();
			return undefined;
		});

		this.#next?.close();
		this.#next = undefined;
		this.#signals.close();

		this.detection.close();
	}
}
