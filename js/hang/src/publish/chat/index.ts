import { Effect, type Getter, Signal } from "@kixelated/signals";
import type * as Catalog from "../../catalog";
import { Message, type MessageProps } from "./message";
import { Typing, type TypingProps } from "./typing";

export * from "./message";
export * from "./typing";

export type Props = {
	message?: MessageProps;
	typing?: TypingProps;
};

export class Root {
	message: Message;
	typing: Typing;

	#catalog = new Signal<Catalog.Chat | undefined>(undefined);
	readonly catalog: Getter<Catalog.Chat | undefined> = this.#catalog;

	#signals = new Effect();

	constructor(props?: Props) {
		this.message = new Message(props?.message);
		this.typing = new Typing(props?.typing);

		this.#signals.effect((effect) => {
			this.#catalog.set({
				message: effect.get(this.message.catalog),
				typing: effect.get(this.typing.catalog),
			});
		});
	}

	close() {
		this.#signals.close();
		this.message.close();
		this.typing.close();
	}
}
