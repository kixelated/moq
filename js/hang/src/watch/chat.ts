import type * as Moq from "@kixelated/moq";
import { Root, Signal, Unique } from "@kixelated/signals";
import { Container } from "..";
import type * as Catalog from "../catalog";

export interface ChatProps {
	// Whether to start downloading the chat.
	// Defaults to false so you can make sure everything is ready before starting.
	enabled?: boolean;
}

const DEFAULT_TTL = 10_000;

export class Chat {
	broadcast: Signal<Moq.BroadcastConsumer | undefined>;

	enabled: Signal<boolean>;
	catalog = new Unique<Catalog.Chat | undefined>(undefined);
	track = new Unique<Container.ChatConsumer | undefined>(undefined);
	ttl = new Signal<DOMHighResTimeStamp | undefined>(undefined);

	#signals = new Root();

	constructor(
		broadcast: Signal<Moq.BroadcastConsumer | undefined>,
		catalog: Signal<Catalog.Root | undefined>,
		props?: ChatProps,
	) {
		this.broadcast = broadcast;
		this.enabled = new Signal(props?.enabled ?? false);

		// Grab the chat section from the catalog (if it's changed).
		this.#signals.effect((effect) => {
			if (!effect.get(this.enabled)) return;
			this.catalog.set(effect.get(catalog)?.chat);
		});

		// TODO enforce the TTL?
		this.#signals.effect((effect) => {
			this.ttl.set(effect.get(this.catalog)?.ttl ?? DEFAULT_TTL);
		});

		this.#signals.effect((effect) => {
			const catalog = effect.get(this.catalog);
			if (!catalog) {
				return;
			}

			const broadcast = effect.get(this.broadcast);
			if (!broadcast) {
				return;
			}

			const track = broadcast.subscribe(catalog.track.name, catalog.track.priority);
			const consumer = new Container.ChatConsumer(track);

			effect.cleanup(() => consumer.close());
			this.track.set(consumer);
			effect.cleanup(() => this.track.set(undefined));
		});
	}

	close() {
		this.#signals.close();
	}
}
