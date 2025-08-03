import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import type * as Catalog from "../catalog";
import { u8 } from "../catalog/integers";

export type ChatProps = {
	enabled?: boolean;
};

export class Chat {
	broadcast: Moq.BroadcastProducer;
	enabled: Signal<boolean>;
	message: Signal<string | undefined>;
	catalog = new Signal<Catalog.Chat | undefined>(undefined);

	// Always create the track, even if we're not publishing it
	#track = new Moq.TrackProducer("chat.md", 0);
	#signals = new Effect();

	constructor(broadcast: Moq.BroadcastProducer, props?: ChatProps) {
		this.broadcast = broadcast;
		this.enabled = new Signal(props?.enabled ?? false);
		this.message = new Signal<string | undefined>(undefined);

		this.#signals.effect((effect) => {
			const enabled = effect.get(this.enabled);
			if (!enabled) return;

			broadcast.insertTrack(this.#track.consume());
			effect.cleanup(() => broadcast.removeTrack(this.#track.name));

			this.catalog.set({
				track: { name: this.#track.name, priority: u8(this.#track.priority) },
			});
		});

		this.#signals.effect((effect) => {
			const message = effect.get(this.message);

			// We currently only support a single message per group.
			const group = this.#track.appendGroup();
			group.writeFrame(new TextEncoder().encode(message));
			group.close();
		});
	}

	close() {
		this.#signals.close();
	}
}
