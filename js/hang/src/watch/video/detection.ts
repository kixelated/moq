import type * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import * as Catalog from "../../catalog";

export interface DetectionProps {
	// Whether to start downloading the detection data.
	// Defaults to false so you can make sure everything is ready before starting.
	enabled?: boolean;
}

export class Detection {
	broadcast: Signal<Moq.BroadcastConsumer | undefined>;

	enabled: Signal<boolean>;
	objects = new Signal<Catalog.DetectionObjects | undefined>(undefined);

	#catalog = new Signal<Catalog.Detection | undefined>(undefined);

	#signals = new Effect();

	constructor(
		broadcast: Signal<Moq.BroadcastConsumer | undefined>,
		catalog: Signal<Catalog.Root | undefined>,
		props?: DetectionProps,
	) {
		this.broadcast = broadcast;
		this.enabled = new Signal(props?.enabled ?? false);

		// Grab the detection section from the catalog (if it's changed).
		this.#signals.effect((effect) => {
			if (!effect.get(this.enabled)) return;
			this.#catalog.set(effect.get(catalog)?.detection);
		});

		this.#signals.effect((effect) => {
			const catalog = effect.get(this.#catalog);
			if (!catalog) return;

			const broadcast = effect.get(this.broadcast);
			if (!broadcast) return;

			const track = broadcast.subscribe(catalog.track.name, catalog.track.priority);
			effect.cleanup(() => track.close());

			effect.spawn(async (cancel) => {
				for (;;) {
					const frame = await Promise.race([track.nextFrame(), cancel]);
					if (!frame) break;

					const decoder = new TextDecoder();
					const text = decoder.decode(frame.data);

					const objects = Catalog.DetectionObjectsSchema.parse(JSON.parse(text));
					// Use a function to avoid the dequal check.
					this.objects.set(() => objects);
				}
			});

			effect.cleanup(() => this.objects.set(undefined));
		});
	}

	close() {
		this.#signals.close();
	}
}
