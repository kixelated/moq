import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import * as Catalog from "../../catalog";
import { TRACKS } from "../tracks";

export type TypingProps = {
	enabled?: boolean | Signal<boolean>;
};

export class Typing {
	enabled: Signal<boolean>;

	// Whether the user is typing.
	active: Signal<boolean>;

	catalog = new Signal<Catalog.Track | undefined>(undefined);

	#signals = new Effect();

	constructor(props?: TypingProps) {
		this.enabled = Signal.from(props?.enabled ?? false);
		this.active = new Signal<boolean>(false);

		this.#signals.effect((effect) => {
			const enabled = effect.get(this.enabled);
			if (!enabled) return;

			this.catalog.set(TRACKS.typing);
		});
	}

	serve(track: Moq.Track, effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const active = effect.get(this.active);
		track.writeBool(active);
	}

	close() {
		this.#signals.close();
	}
}
