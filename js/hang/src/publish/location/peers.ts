import * as Moq from "@kixelated/moq";
import * as Zod from "@kixelated/moq/zod";
import { Effect, Signal } from "@kixelated/signals";
import * as Catalog from "../../catalog";
import { PRIORITY } from "../priority";

export interface PeersProps {
	enabled?: boolean | Signal<boolean>;
	positions?: Record<string, Catalog.Position> | Signal<Record<string, Catalog.Position>>;
}

export class Peers {
	static readonly TRACK = "location/peers.json";
	static readonly PRIORITY = PRIORITY.location;

	enabled: Signal<boolean>;
	positions = new Signal<Record<string, Catalog.Position>>({});

	catalog = new Signal<Catalog.Track | undefined>(undefined);
	signals = new Effect();

	constructor(props?: PeersProps) {
		this.enabled = Signal.from(props?.enabled ?? false);
		this.positions = Signal.from(props?.positions ?? {});

		this.signals.effect((effect) => {
			const enabled = effect.get(this.enabled);
			if (!enabled) return;

			effect.set(this.catalog, { name: Peers.TRACK, priority: Peers.PRIORITY });
		});
	}

	serve(track: Moq.Track, effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const positions = effect.get(this.positions);
		if (!positions) return;

		Zod.write(track, positions, Catalog.PeersSchema);
	}

	close() {
		this.signals.close();
	}
}
