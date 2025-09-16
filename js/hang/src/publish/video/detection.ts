import * as Moq from "@kixelated/moq";
import { Effect, type Getter, Signal } from "@kixelated/signals";
import * as Comlink from "comlink";
import * as Catalog from "../../catalog";
import type { DetectionWorker } from "./detection-worker";
// Vite-specific import for worker
import WorkerUrl from "./detection-worker?worker&url";

export type DetectionProps = {
	enabled?: boolean | Signal<boolean>;
	interval?: number;
	threshold?: number;
};

export class Detection {
	broadcast: Moq.BroadcastProducer;
	frame: () => VideoFrame | undefined;

	enabled: Signal<boolean>;
	objects = new Signal<Catalog.DetectionObjects | undefined>(undefined);

	#interval: number;
	#threshold: number;

	#catalog = new Signal<Catalog.Detection | undefined>(undefined);
	readonly catalog: Getter<Catalog.Detection | undefined> = this.#catalog;

	#track: Moq.TrackProducer;

	signals = new Effect();

	constructor(broadcast: Moq.BroadcastProducer, frame: () => VideoFrame | undefined, props?: DetectionProps) {
		this.broadcast = broadcast;
		this.frame = frame;
		this.enabled = Signal.from(props?.enabled ?? false);
		this.#interval = props?.interval ?? 1000;
		this.#threshold = props?.threshold ?? 0.5;

		this.#track = new Moq.TrackProducer(`detection.json`, 1);
		this.signals.cleanup(() => this.#track.close());

		this.signals.effect(this.#run.bind(this));
	}

	#run(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		this.broadcast.insertTrack(this.#track.consume());
		effect.cleanup(() => this.broadcast.removeTrack(this.#track.name));

		// Set the detection catalog
		this.#catalog.set({
			track: { name: this.#track.name, priority: Catalog.u8(this.#track.priority) },
		});

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
			this.#track.writeJson(result);

			// Schedule the next detection only after this one is complete.
			// Otherwise, we're in trouble if it takes >= interval to complete.
			timeout = setTimeout(process, this.#interval);
		};

		effect.cleanup(() => this.objects.set(undefined));
	}

	close() {
		this.signals.close();
		this.#track.close();
	}
}
