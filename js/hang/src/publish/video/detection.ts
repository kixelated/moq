import * as Moq from "@kixelated/moq";
import { Effect, type Getter, Signal } from "@kixelated/signals";
import * as Comlink from "comlink";
import * as Catalog from "../../catalog";
import type { DetectionWorker } from "./detection-worker";
// Vite-specific import for worker
import WorkerUrl from "./detection-worker?worker&url";
import { TRACKS } from "../tracks";

export type DetectionProps = {
	enabled?: boolean | Signal<boolean>;
	interval?: number;
	threshold?: number;
};

export class Detection {
	frame: () => VideoFrame | undefined;

	enabled: Signal<boolean>;
	objects = new Signal<Catalog.DetectionObjects | undefined>(undefined);

	#interval: number;
	#threshold: number;

	#catalog = new Signal<Catalog.Detection | undefined>(undefined);
	readonly catalog: Getter<Catalog.Detection | undefined> = this.#catalog;

	signals = new Effect();

	constructor(frame: () => VideoFrame | undefined, props?: DetectionProps) {
		this.frame = frame;
		this.enabled = Signal.from(props?.enabled ?? false);
		this.#interval = props?.interval ?? 1000;
		this.#threshold = props?.threshold ?? 0.5;
		this.signals.effect(this.#runCatalog.bind(this));
	}

	#runCatalog(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		this.#catalog.set({
			track: TRACKS.detection,
		});
	}

	serve(track: Moq.Track, effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		// Initialize worker
		const worker = new Worker(WorkerUrl, { type: "module" });
		effect.cleanup(() => worker.terminate());

		const api = Comlink.wrap<DetectionWorker>(worker);

		let timeout: ReturnType<typeof setTimeout>;
		effect.cleanup(() => clearTimeout(timeout));

		effect.spawn(async () => {
			const ready = await api.ready();
			if (!ready) return;
			process();
		});

		const process = async () => {
			const frame = this.frame();
			if (!frame) return;

			const cloned = frame.clone();
			const result = await api.detect(Comlink.transfer(cloned, [cloned]), this.#threshold);

			this.objects.set(result);
			track.writeJson(result);

			// Schedule the next detection only after this one is complete.
			// Otherwise, we're in trouble if it takes >= interval to complete.
			timeout = setTimeout(process, this.#interval);
		};

		effect.cleanup(() => this.objects.set(undefined));
	}

	close() {
		this.signals.close();
	}
}
