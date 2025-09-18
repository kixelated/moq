import * as Moq from "@kixelated/moq";
import * as Zod from "@kixelated/moq/zod";
import { Effect, Signal } from "@kixelated/signals";
import * as Catalog from "../catalog";
import { PRIORITY } from "./priority";

export interface PreviewProps {
	enabled?: boolean | Signal<boolean>;
}

export class Preview {
	broadcast: Signal<Moq.Broadcast | undefined>;
	enabled: Signal<boolean>;
	preview = new Signal<Catalog.Preview | undefined>(undefined);
	#catalog = new Signal<Catalog.Track | undefined>(undefined);

	#signals = new Effect();

	constructor(
		broadcast: Signal<Moq.Broadcast | undefined>,
		catalog: Signal<Catalog.Root | undefined>,
		props?: PreviewProps,
	) {
		this.broadcast = broadcast;
		this.enabled = Signal.from(props?.enabled ?? false);

		this.#signals.effect((effect) => {
			this.#catalog.set(effect.get(catalog)?.preview);
		});

		this.#signals.effect((effect) => {
			if (!effect.get(this.enabled)) return;

			const broadcast = effect.get(this.broadcast);
			if (!broadcast) return;

			const name = effect.get(this.#catalog);
			if (!name) return;

			// Subscribe to the preview.json track directly
			const track = broadcast.subscribe(name, PRIORITY.preview);
			effect.cleanup(() => track.close());

			effect.spawn(async () => {
				try {
					const info = await Zod.read(track, Catalog.PreviewSchema);
					if (!info) return;

					this.preview.set(info);
				} catch (error) {
					console.warn("Failed to parse preview JSON:", error);
				}
			});

			effect.cleanup(() => this.preview.set(undefined));
		});
	}

	close() {
		this.#signals.close();
	}
}
