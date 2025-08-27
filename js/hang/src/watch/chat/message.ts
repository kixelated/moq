import type * as Moq from "@kixelated/moq";
import { Effect, type Getter, Signal } from "@kixelated/signals";
import type * as Catalog from "../../catalog";

export interface MessageProps {
	// Whether to start downloading the chat.
	// Defaults to false so you can make sure everything is ready before starting.
	enabled?: boolean;
}

export class Message {
	broadcast: Signal<Moq.BroadcastConsumer | undefined>;
	enabled: Signal<boolean>;

	// Empty string is a valid message.
	#latest = new Signal<string | undefined>(undefined);
	readonly latest: Getter<string | undefined> = this.#latest;

	#catalog = new Signal<Catalog.Track | undefined>(undefined);
	readonly catalog: Getter<Catalog.Track | undefined> = this.#catalog;

	#signals = new Effect();

	constructor(
		broadcast: Signal<Moq.BroadcastConsumer | undefined>,
		catalog: Signal<Catalog.Root | undefined>,
		props?: MessageProps,
	) {
		this.broadcast = broadcast;
		this.enabled = new Signal(props?.enabled ?? false);

		// Grab the chat section from the catalog (if it's changed).
		this.#signals.effect((effect) => {
			if (!effect.get(this.enabled)) return;
			this.#catalog.set(effect.get(catalog)?.chat?.message);
		});

		this.#signals.effect(this.#run.bind(this));
	}

	#run(effect: Effect) {
		if (!effect.get(this.enabled)) return;

		const catalog = effect.get(this.#catalog);
		if (!catalog) return;

		const broadcast = effect.get(this.broadcast);
		if (!broadcast) return;

		const track = broadcast.subscribe(catalog.name, catalog.priority);
		effect.cleanup(() => track.close());

		// Undefined is only when we're not subscribed to the track.
		effect.set(this.#latest, "");
		effect.cleanup(() => this.#latest.set(undefined));

		effect.spawn(async (cancel) => {
			for (;;) {
				const frame = await Promise.race([track.readString(), cancel]);
				if (frame === undefined) break;

				// Use a function to avoid the dequal check.
				this.#latest.set(frame);
			}
		});
	}

	close() {
		this.#signals.close();
	}
}
