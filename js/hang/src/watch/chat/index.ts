import type * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import type * as Catalog from "../../catalog";
import { Message, type MessageProps } from "./message";
import { Typing, type TypingProps } from "./typing";

export interface ChatProps {
	message?: MessageProps;
	typing?: TypingProps;
}

export class Chat {
	message: Message;
	typing: Typing;

	#catalog = new Signal<Catalog.Chat | undefined>(undefined);
	#signals = new Effect();

	constructor(
		broadcast: Signal<Moq.BroadcastConsumer | undefined>,
		catalog: Signal<Catalog.Root | undefined>,
		props?: ChatProps,
	) {
		this.message = new Message(broadcast, catalog, props?.message);
		this.typing = new Typing(broadcast, catalog, props?.typing);

		// Grab the chat section from the catalog (if it's changed).
		this.#signals.effect((effect) => {
			const message = effect.get(this.message.catalog);
			const typing = effect.get(this.typing.catalog);
			if (!message && !typing) return;

			effect.set(this.#catalog, {
				message,
				typing,
			});
		});
	}

	close() {
		this.#signals.close();
		this.message.close();
		this.typing.close();
	}
}
