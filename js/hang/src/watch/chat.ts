import type * as Moq from "@kixelated/moq";
import { type Computed, Root, Signal } from "@kixelated/signals";
import { Container } from "..";
import type * as Catalog from "../catalog";

export interface ChatProps {
	// Whether to start downloading the chat.
	// Defaults to false so you can make sure everything is ready before starting.
	enabled?: boolean;
}

export class Chat {
	broadcast: Signal<Moq.BroadcastConsumer | undefined>;

	enabled: Signal<boolean>;
	catalog: Computed<Catalog.Chat | undefined>;
	track: Computed<Container.ChatConsumer | undefined>;
	ttl: Computed<DOMHighResTimeStamp | undefined>;

	#signals = new Root();

	constructor(
		broadcast: Signal<Moq.BroadcastConsumer | undefined>,
		catalog: Signal<Catalog.Root | undefined>,
		props?: ChatProps,
	) {
		this.broadcast = broadcast;
		this.enabled = new Signal(props?.enabled ?? false);

		// Grab the chat section from the catalog (if it's changed).
		this.catalog = this.#signals.unique((effect) => {
			if (!effect.get(this.enabled)) return undefined;
			return effect.get(catalog)?.chat;
		});

		// TODO enforce the TTL?
		this.ttl = this.#signals.computed((effect) => {
			return effect.get(this.catalog)?.ttl;
		});

		this.track = this.#signals.computed((effect) => {
			const catalog = effect.get(this.catalog);
			if (!catalog) return undefined;

			const broadcast = effect.get(this.broadcast);
			if (!broadcast) return undefined;

			const track = broadcast.subscribe(catalog.track.name, catalog.track.priority);
			const consumer = new Container.ChatConsumer(track);

			effect.cleanup(() => consumer.close());
			return consumer;
		});
	}

	close() {
		this.#signals.close();
	}
}
