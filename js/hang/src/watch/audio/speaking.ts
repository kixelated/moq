import * as Moq from "@kixelated/moq";
import { Effect, type Getter, Signal } from "@kixelated/signals";
import * as Catalog from "../../catalog";

export type SpeakingProps = {
	enabled?: boolean | Signal<boolean>;
};

export class Speaking {
	broadcast: Getter<Moq.Broadcast | undefined>;
	catalog = new Signal<Catalog.Speaking | undefined>(undefined);
	enabled: Signal<boolean>;

	// Toggles true when the user is speaking.
	#active = new Signal<boolean | undefined>(undefined);
	readonly active: Getter<boolean | undefined> = this.#active;

	#signals = new Effect();

	constructor(
		broadcast: Getter<Moq.Broadcast | undefined>,
		catalog: Getter<Catalog.Audio | undefined>,
		props?: SpeakingProps,
	) {
		this.broadcast = broadcast;

		this.enabled = Signal.from(props?.enabled ?? false);
		this.#signals.effect(this.#run.bind(this));

		this.#signals.effect((effect) => {
			effect.set(this.catalog, effect.get(catalog)?.speaking);
		});
	}

	#run(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const broadcast = effect.get(this.broadcast);
		if (!broadcast) return;

		const catalog = effect.get(this.catalog);
		if (!catalog) return;

		const sub = broadcast.subscribe(catalog.track.name, catalog.track.priority);
		effect.cleanup(() => sub.close());

		effect.spawn(async () => {
			for (;;) {
				const speaking = await sub.readBool();
				if (speaking === undefined) break;

				this.#active.set(speaking);
			}
		});
		effect.cleanup(() => this.#active.set(undefined));
	}

	close() {
		this.#signals.close();
	}
}
