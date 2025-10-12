import * as Moq from "@kixelated/moq";
import { Effect, type Getter, Signal } from "@kixelated/signals";
import * as Catalog from "../../catalog";

export type CaptionsProps = {
	enabled?: boolean | Signal<boolean>;
};

export class Captions {
	broadcast: Getter<Moq.Broadcast | undefined>;
	info: Getter<Catalog.Audio | undefined>;
	enabled: Signal<boolean>;

	// The most recent caption downloaded.
	#text = new Signal<string | undefined>(undefined);
	readonly text: Getter<string | undefined> = this.#text;

	#signals = new Effect();

	constructor(
		broadcast: Getter<Moq.Broadcast | undefined>,
		info: Getter<Catalog.Audio | undefined>,
		props?: CaptionsProps,
	) {
		this.broadcast = broadcast;
		this.info = info;

		this.enabled = Signal.from(props?.enabled ?? false);
		this.#signals.effect(this.#run.bind(this));
	}

	#run(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const broadcast = effect.get(this.broadcast);
		if (!broadcast) return;

		const info = effect.get(this.info);
		if (!info) return;

		if (!info.captions) return;

		const sub = broadcast.subscribe(info.captions.track.name, info.captions.track.priority);
		effect.cleanup(() => sub.close());

		effect.spawn(async () => {
			for (;;) {
				const frame = await sub.readString();
				if (frame === undefined) break; // don't treat "" as EOS
				this.#text.set(frame);
			}
		});
		effect.cleanup(() => this.#text.set(undefined));
	}

	close() {
		this.#signals.close();
	}
}
