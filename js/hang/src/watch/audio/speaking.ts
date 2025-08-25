import type * as Moq from "@kixelated/moq";
import { Effect, type Getter, Signal } from "@kixelated/signals";
import type * as Catalog from "../../catalog";

export type SpeakingProps = {
	enabled?: boolean;
};

export class Speaking {
	broadcast: Getter<Moq.BroadcastConsumer | undefined>;
	info: Getter<Catalog.Audio | undefined>;
	enabled: Signal<boolean>;

	// Toggles true when the user is speaking.
	#active = new Signal<boolean | undefined>(undefined);
	readonly active: Getter<boolean | undefined> = this.#active;

	#signals = new Effect();

	constructor(
		broadcast: Getter<Moq.BroadcastConsumer | undefined>,
		info: Getter<Catalog.Audio | undefined>,
		props?: SpeakingProps,
	) {
		this.broadcast = broadcast;
		this.info = info;

		this.enabled = new Signal(props?.enabled ?? false);
		this.#signals.effect(this.#run.bind(this));
	}

	#run(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const broadcast = effect.get(this.broadcast);
		if (!broadcast) return;

		const info = effect.get(this.info);
		if (!info) return;

		if (!info.speaking) return;

		const sub = broadcast.subscribe(info.speaking.track.name, info.speaking.track.priority);
		effect.cleanup(() => sub.close());

		effect.spawn(async (cancel) => {
			for (;;) {
				const frame = await Promise.race([sub.nextFrame(), cancel]);
				if (!frame) break;

				const active = frame.data.length > 0;
				this.#active.set(active);
			}
		});
		effect.cleanup(() => this.#active.set(undefined));
	}

	close() {
		this.#signals.close();
	}
}
