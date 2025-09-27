import * as Moq from "@kixelated/moq";
import { Effect, type Getter, Signal } from "@kixelated/signals";
import * as Comlink from "comlink";
import * as Catalog from "../../catalog";
import type { DetectionWorker } from "./detection-worker";
// Vite-specific import for worker
import WorkerUrl from "./detection-worker?worker&url";
import { TrackProcessor } from "./polyfill";
import { Source } from "./types";

export type DetectionProps = {
	enabled?: boolean | Signal<boolean>;
	interval?: number;
	threshold?: number;
};

export class Detection {
	static readonly TRACK: Catalog.Track = "video/detection.json";

	enabled: Signal<boolean>;
	source: Signal<Source | undefined>;
	objects = new Signal<Catalog.DetectionObjects | undefined>(undefined);

	#interval: number;
	#threshold: number;

	#catalog = new Signal<Catalog.Detection | undefined>(undefined);
	readonly catalog: Getter<Catalog.Detection | undefined> = this.#catalog;

	signals = new Effect();

	constructor(source: Signal<Source | undefined>, props?: DetectionProps) {
		this.source = source;
		this.enabled = Signal.from(props?.enabled ?? false);
		this.#interval = props?.interval ?? 1000;
		this.#threshold = props?.threshold ?? 0.5;
		this.signals.effect(this.#runCatalog.bind(this));
	}

	#runCatalog(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		this.#catalog.set({
			track: Detection.TRACK,
		});
	}

	serve(track: Moq.Track, effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const source = effect.get(this.source);
		if (!source) return;

		// Initialize worker
		const worker = new Worker(WorkerUrl, { type: "module" });
		effect.cleanup(() => worker.terminate());

		const api = Comlink.wrap<DetectionWorker>(worker);

		const reader = TrackProcessor(source).getReader();
		effect.cleanup(() => reader.cancel());

		effect.spawn(async () => {
			const ready = await api.ready();
			if (!ready) return;

			let { value: frame } = await reader.read();
			if (!frame) return;

			effect.interval(async () => {
				if (!frame) return;

				const cloned = frame.clone();
				const result = await api.detect(Comlink.transfer(cloned, [cloned]), this.#threshold);

				this.objects.set(result);
				track.writeJson(result);
			}, this.#interval);

			while (frame) {
				frame.close();

				const next = await Promise.race([reader.read(), effect.cancel]);
				if (!next) break;

				frame = next.value;
			}
		});

		effect.cleanup(() => this.objects.set(undefined));
	}

	close() {
		this.signals.close();
	}
}
