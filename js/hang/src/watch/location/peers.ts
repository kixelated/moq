import * as Moq from "@kixelated/moq";
import * as Zod from "@kixelated/moq/zod";
import { Effect, Signal } from "@kixelated/signals";
import * as Catalog from "../../catalog";
import { PRIORITY } from "../priority";

export interface PeersProps {
	enabled?: boolean | Signal<boolean>;
}

export class Peers {
	enabled: Signal<boolean>;
	broadcast: Signal<Moq.Broadcast | undefined>;

	#catalog = new Signal<Catalog.Track | undefined>(undefined);
	positions = new Signal<Record<string, Catalog.Position> | undefined>(undefined);

	signals = new Effect();

	constructor(
		broadcast: Signal<Moq.Broadcast | undefined>,
		catalog: Signal<Catalog.Root | undefined>,
		props?: PeersProps,
	) {
		this.broadcast = broadcast;
		this.enabled = Signal.from(props?.enabled ?? false);

		this.signals.effect((effect) => {
			this.#catalog.set(effect.get(catalog)?.location?.peers);
		});

		this.signals.effect(this.#run.bind(this));
	}

	#run(effect: Effect) {
		if (!effect.get(this.enabled)) return;

		const catalog = effect.get(this.#catalog);
		if (!catalog) return;

		const broadcast = effect.get(this.broadcast);
		if (!broadcast) return;

		const track = broadcast.subscribe(catalog, PRIORITY.location);
		effect.cleanup(() => track.close());

		effect.spawn(this.#runTrack.bind(this, track));
	}

	async #runTrack(track: Moq.Track) {
		try {
			for (;;) {
				const frame = await Zod.read(track, Catalog.PeersSchema);
				if (!frame) break;

				this.positions.set(frame);
			}
		} finally {
			this.positions.set(undefined);
			track.close();
		}
	}

	close() {
		this.signals.close();
	}
}
