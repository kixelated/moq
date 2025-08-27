import * as Moq from "@kixelated/moq";
import { Effect, type Getter, Signal } from "@kixelated/signals";
import * as Comlink from "comlink";
import * as Catalog from "../../catalog";
import type { Video } from ".";
import type { DetectionWorker } from "./detection-worker";

export type DetectionProps = {
	enabled?: boolean;
	interval?: number;
	threshold?: number;
};

export class Detection {
	video: Video;
	enabled: Signal<boolean>;
	objects = new Signal<Catalog.DetectionObjects | undefined>(undefined);

	#interval: number;
	#threshold: number;

	#catalog = new Signal<Catalog.Detection | undefined>(undefined);
	readonly catalog: Getter<Catalog.Detection | undefined> = this.#catalog;

	#track: Moq.TrackProducer;

	signals = new Effect();

	constructor(video: Video, props?: DetectionProps) {
		this.video = video;
		this.enabled = new Signal(props?.enabled ?? false);
		this.#interval = props?.interval ?? 1000;
		this.#threshold = props?.threshold ?? 0.5;

		this.#track = new Moq.TrackProducer(`detection.json`, 1);
		this.signals.cleanup(() => this.#track.close());

		this.signals.effect(this.#run.bind(this));
	}

	#run(effect: Effect): void {
		if (!effect.get(this.enabled)) return;
		if (!effect.get(this.video.enabled)) return;

		this.video.broadcast.insertTrack(this.#track.consume());
		effect.cleanup(() => this.video.broadcast.removeTrack(this.#track.name));

		// Set the detection catalog
		this.#catalog.set({
			track: { name: this.#track.name, priority: Catalog.u8(this.#track.priority) },
		});

		const worker = new Worker(new URL("./detection-worker", import.meta.url), { type: "module" });
		effect.cleanup(() => worker.terminate());

		const api = Comlink.wrap<DetectionWorker>(worker);

		let timeout: ReturnType<typeof setTimeout>;
		effect.cleanup(() => clearTimeout(timeout));

		effect.spawn(async (cancel) => {
			const ready = await Promise.race([api.ready(), cancel]);
			if (!ready) return;

			process();
		});

		const process = async () => {
			const frame = this.video.frame.peek();
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
