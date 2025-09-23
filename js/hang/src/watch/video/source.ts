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
	latency?: Time.Milli | Signal<Time.Milli>;
};

// Responsible for switching between video tracks and buffering frames.
export class Source {
	broadcast: Signal<Moq.Broadcast | undefined>;
	enabled: Signal<boolean>; // Don't download any longer
	catalog: Signal<Catalog.Root | undefined>;
	info = new Signal<Catalog.Video | undefined>(undefined);

	// Helper that is populated from the catalog.
	#flip = new Signal<boolean | undefined>(undefined);
	readonly flip: Getter<boolean | undefined> = this.#flip;

	detection: Detection;

	frame = new Signal<VideoFrame | undefined>(undefined);

	latency: Signal<Time.Milli>;

	#signals = new Effect();

	constructor(
		broadcast: Signal<Moq.Broadcast | undefined>,
		catalog: Signal<Catalog.Root | undefined>,
		props?: SourceProps,
	) {
		this.broadcast = broadcast;
		this.catalog = catalog;
		this.latency = Signal.from(props?.latency ?? (100 as Time.Milli));
		this.enabled = Signal.from(props?.enabled ?? false);
		this.detection = new Detection(this.broadcast, this.catalog, props?.detection);

		// TODO use isConfigSupported
		this.#signals.effect((effect) => {
			// NOTE: Not gated based on enabled
			const info = effect.get(this.catalog)?.video?.[0];
			effect.set(this.info, info);
			effect.set(this.#flip, info?.config.flip, undefined);
		});

		this.#signals.effect(this.#init.bind(this));
	}

	#init(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const info = effect.get(this.info);
		if (!info) return;

		const broadcast = effect.get(this.broadcast);
		if (!broadcast) return;

		// We don't clear previous frames so we can seamlessly switch tracks.
		const sub = broadcast.subscribe(info.track, PRIORITY.video);
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

		const config = info.config;
		const description = config.description ? Hex.toBytes(config.description) : undefined;

		decoder.configure({
			...config,
			description,
			optimizeForLatency: config.optimizeForLatency ?? true,
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
