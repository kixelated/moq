import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import type * as Catalog from "../../catalog";
import { u8 } from "../../catalog/integers";

export type TypingProps = {
	enabled?: boolean | Signal<boolean>;
};

export class Typing {
	broadcast: Moq.BroadcastProducer;
	enabled: Signal<boolean>;

	// Whether the user is typing.
	active: Signal<boolean>;

	catalog = new Signal<Catalog.Track | undefined>(undefined);

	// Always create the tracks, even if we're not publishing it
	#track = new Moq.TrackProducer("chat.bool", 0);

	#signals = new Effect();

	constructor(broadcast: Moq.BroadcastProducer, props?: TypingProps) {
		this.broadcast = broadcast;
		this.enabled = Signal.from(props?.enabled ?? false);
		this.active = new Signal<boolean>(false);

		this.#signals.effect((effect) => {
			const enabled = effect.get(this.enabled);
			if (!enabled) return;

			broadcast.insertTrack(this.#track.consume());
			effect.cleanup(() => broadcast.removeTrack(this.#track.name));

			this.catalog.set({
				name: this.#track.name,
				priority: u8(this.#track.priority),
			});
		});

		this.#signals.effect((effect) => {
			const enabled = effect.get(this.enabled);
			if (!enabled) return;

			const active = effect.get(this.active);
			this.#track.writeBool(active);
		});
	}

	close() {
		this.#signals.close();
		this.#track.close();
	}
}
