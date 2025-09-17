import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import * as Catalog from "../catalog";
import { TRACKS } from "./tracks";

export type LocationProps = {
	// If true, then we'll publish our position to the broadcast.
	enabled?: boolean | Signal<boolean>;

	// Our initial position.
	current?: Catalog.Position | Signal<Catalog.Position | undefined>;

	// If set, then this broadcaster allows other peers to request position updates via this handle.
	handle?: string | Signal<string | undefined>;
};

export class Location {
	enabled: Signal<boolean>;

	current: Signal<Catalog.Position | undefined>;
	handle: Signal<string | undefined>; // Allow other peers to request position updates via this handle.

	catalog = new Signal<Catalog.Location | undefined>(undefined);

	#peers = new Signal<Record<string, Catalog.Track> | undefined>(undefined);

	#signals = new Effect();

	constructor(props?: LocationProps) {
		this.enabled = Signal.from(props?.enabled ?? false);
		this.current = Signal.from(props?.current ?? undefined);
		this.handle = Signal.from(props?.handle ?? undefined);

		this.#signals.effect((effect) => {
			const enabled = effect.get(this.enabled);
			if (!enabled) {
				return;
			}

			effect.set(
				this.catalog,
				{
					initial: this.current.peek(), // Doesn't trigger a re-render
					updates: TRACKS.location,
					handle: effect.get(this.handle),
					peers: effect.get(this.#peers),
				},
				undefined,
			);
		});
	}

	serve(track: Moq.Track, effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const position = effect.get(this.current);
		if (!position) return;

		track.writeJson(position);
	}

	close() {
		this.#signals.close();
	}
}

/*
export class LocationPeer {
	handle: Signal<string | undefined>;
	catalog: Signal<Record<string, Catalog.Track> | undefined>;
	producer = new Signal<Moq.Track | undefined>(undefined);

	#signals = new Effect();

	constructor(
		catalog: Signal<Record<string, Catalog.Track> | undefined>,
		handle?: string,
	) {
		this.handle = Signal.from(handle);
		this.catalog = catalog;

		this.#signals.effect((effect) => {
			const handle = effect.get(this.handle);
			if (!handle) {
				return;
			}

			const track = new Moq.Track(`peer/${handle}/location.json`, 0);
			effect.cleanup(() => track.close());

			broadcast.insertTrack(track.consume());
			effect.cleanup(() => broadcast.removeTrack(track.name));

			this.catalog.update((prev) => {
				return {
					...(prev ?? {}),
					[handle]: {
						name: track.name,
						priority: u8(track.priority),
					},
				};
			});

			effect.cleanup(() => {
				this.catalog.update((prev) => {
					const { [handle]: _, ...rest } = prev ?? {};
					return {
						...rest,
					};
				});
			});

			effect.set(this.producer, track);
		});
	}

	close() {
		this.#signals.close();
	}
}
*/
