import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import * as Catalog from "../../catalog";
import { TRACKS } from "../tracks";

export type MessageProps = {
	enabled?: boolean | Signal<boolean>;
};

export class Message {
	enabled: Signal<boolean>;

	// The latest message to publish.
	latest: Signal<string>;

	catalog = new Signal<Catalog.Track | undefined>(undefined);

	#signals = new Effect();

	constructor(props?: MessageProps) {
		this.enabled = Signal.from(props?.enabled ?? false);
		this.latest = new Signal<string>("");

		this.#signals.effect((effect) => {
			const enabled = effect.get(this.enabled);
			if (!enabled) return;

			this.catalog.set(TRACKS.chat.message);
		});
	}

	serve(track: Moq.Track, effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const latest = effect.get(this.latest);
		track.writeString(latest ?? "");
	}

	close() {
		this.#signals.close();
	}
}
