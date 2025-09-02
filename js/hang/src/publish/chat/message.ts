import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import type * as Catalog from "../../catalog";
import { u8 } from "../../catalog/integers";

export type MessageProps = {
	enabled?: boolean | Signal<boolean>;
};

export class Message {
	broadcast: Moq.BroadcastProducer;
	enabled: Signal<boolean>;

	// The latest message to publish.
	latest: Signal<string>;

	catalog = new Signal<Catalog.Track | undefined>(undefined);

	// Always create the tracks, even if we're not publishing it
	#track = new Moq.TrackProducer("chat.txt", 0);

	#signals = new Effect();

	constructor(broadcast: Moq.BroadcastProducer, props?: MessageProps) {
		this.broadcast = broadcast;
		this.enabled = Signal.from(props?.enabled ?? false);
		this.latest = new Signal<string>("");

		this.#signals.effect((effect) => {
			const enabled = effect.get(this.enabled);
			if (!enabled) return;

			broadcast.insertTrack(this.#track.consume());
			effect.cleanup(() => broadcast.removeTrack(this.#track.name));

			this.catalog.set({ name: this.#track.name, priority: u8(this.#track.priority) });
		});

		this.#signals.effect((effect) => {
			const enabled = effect.get(this.enabled);
			if (!enabled) return;

			const latest = effect.get(this.latest);
			this.#track.writeString(latest ?? "");
		});
	}

	close() {
		this.#signals.close();
		this.#track.close();
	}
}
