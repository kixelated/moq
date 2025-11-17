import * as Moq from "@kixelated/moq";
import * as Zod from "@kixelated/moq/zod";
import { Effect, type Getter, Signal } from "@kixelated/signals";
import * as Catalog from "../../catalog";

export interface PeersProps {
	enabled?: boolean | Signal<boolean>;
}

export class Peers {
	enabled: Signal<boolean>;
	broadcast: Signal<Moq.Broadcast | undefined>;

	#catalog = new Signal<Catalog.Track | undefined>(undefined);
	#positions = new Signal<Record<string, Catalog.Position> | undefined>(undefined);

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
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const catalog = effect.get(this.#catalog);
		if (!catalog) return;

		const broadcast = effect.get(this.broadcast);
		if (!broadcast) return;

		const track = new Moq.Track({ name: catalog.name, priority: catalog.priority });
		effect.cleanup(() => track.close());

		broadcast.subscribe(track);

		effect.spawn(this.#runTrack.bind(this, track));
	}

	async #runTrack(track: Moq.Track) {
		try {
			for (;;) {
				const frame = await Zod.read(track, Catalog.PeersSchema);
				if (!frame) break;

				this.#positions.set(frame);
			}
		} finally {
			this.#positions.set(undefined);
			track.close();
		}
	}

	get positions(): Getter<Record<string, Catalog.Position> | undefined> {
		return this.#positions;
	}

	close() {
		this.signals.close();
	}
}
