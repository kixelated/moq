import type * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import type * as Catalog from "../catalog";

export interface ChatProps {
	// Whether to start downloading the chat.
	// Defaults to false so you can make sure everything is ready before starting.
	enabled?: boolean;
}

export class Chat {
	broadcast: Signal<Moq.BroadcastConsumer | undefined>;
	message: Signal<string | undefined>;
	enabled: Signal<boolean>;

	#catalog = new Signal<Catalog.Chat | undefined>(undefined);

	#signals = new Effect();

	constructor(
		broadcast: Signal<Moq.BroadcastConsumer | undefined>,
		catalog: Signal<Catalog.Root | undefined>,
		props?: ChatProps,
	) {
		this.broadcast = broadcast;
		this.message = new Signal<string | undefined>(undefined);
		this.enabled = new Signal(props?.enabled ?? false);

		// Grab the chat section from the catalog (if it's changed).
		this.#signals.effect((effect) => {
			if (!effect.get(this.enabled)) return;
			this.#catalog.set(effect.get(catalog)?.chat);
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

					// Use a function to avoid the dequal check.
					this.message.set(() => text);
				}
			});

			effect.cleanup(() => this.message.set(undefined));
		});
	}

	close() {
		this.#signals.close();
	}
}
