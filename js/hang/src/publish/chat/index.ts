import type * as Moq from "@kixelated/moq";
import { Effect, type Getter, Signal } from "@kixelated/signals";
import type * as Catalog from "../../catalog";
import { Message, type MessageProps } from "./message";
import { Typing, type TypingProps } from "./typing";

export type ChatProps = {
	message?: MessageProps;
	typing?: TypingProps;
};

export class Chat {
	message: Message;
	typing: Typing;

	#catalog = new Signal<Catalog.Chat | undefined>(undefined);
	readonly catalog: Getter<Catalog.Chat | undefined> = this.#catalog;

	#signals = new Effect();

	constructor(broadcast: Moq.BroadcastProducer, props?: ChatProps) {
		this.message = new Message(broadcast, props?.message);
		this.typing = new Typing(broadcast, props?.typing);

		this.#signals.effect((effect) => {
			const message = effect.get(this.message.catalog);
			const typing = effect.get(this.typing.catalog);

			this.#catalog.set({
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
