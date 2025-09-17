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
	catalog: Signal<Catalog.Root | undefined>;
	info = new Signal<Catalog.Video | undefined>(undefined);

	// Helper that is populated from the catalog.
	#flip = new Signal<boolean | undefined>(undefined);
	readonly flip: Getter<boolean | undefined> = this.#flip;

	detection: Detection;

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
		this.catalog = catalog;
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

		const config = info.config;
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
