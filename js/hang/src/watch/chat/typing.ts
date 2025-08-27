import type * as Moq from "@kixelated/moq";
import { Effect, type Getter, Signal } from "@kixelated/signals";
import type * as Catalog from "../../catalog";

export interface TypingProps {
	// Whether to start downloading the chat.
	// Defaults to false so you can make sure everything is ready before starting.
	enabled?: boolean;
}

export class Typing {
	broadcast: Signal<Moq.BroadcastConsumer | undefined>;
	enabled: Signal<boolean>;
	active: Signal<boolean | undefined>;

	#catalog = new Signal<Catalog.Track | undefined>(undefined);
	readonly catalog: Getter<Catalog.Track | undefined> = this.#catalog;

	#signals = new Effect();

	constructor(
		broadcast: Signal<Moq.BroadcastConsumer | undefined>,
		catalog: Signal<Catalog.Root | undefined>,
		props?: TypingProps,
	) {
		this.broadcast = broadcast;
		this.active = new Signal<boolean | undefined>(undefined);
		this.enabled = new Signal(props?.enabled ?? false);

		// Grab the chat section from the catalog (if it's changed).
		this.#signals.effect((effect) => {
			if (!effect.get(this.enabled)) return;
			this.#catalog.set(effect.get(catalog)?.chat?.typing);
		});

		this.#signals.effect(this.#run.bind(this));
	}

	#run(effect: Effect) {
		const catalog = effect.get(this.#catalog);
		if (!catalog) return;

		const broadcast = effect.get(this.broadcast);
		if (!broadcast) return;

		if (!catalog) return;

		const track = broadcast.subscribe(catalog.name, catalog.priority);
		effect.cleanup(() => track.close());

		effect.spawn(async (cancel) => {
			for (;;) {
				const value = await Promise.race([track.readBool(), cancel]);
				if (value === undefined) break;

				this.active.set(value);
			}
		});

		effect.cleanup(() => this.active.set(undefined));
	}

	close() {
		this.#signals.close();
	}
}
