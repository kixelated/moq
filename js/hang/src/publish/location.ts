import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import type * as Catalog from "../catalog";
import { u8 } from "../catalog/integers";
import * as Container from "../container";

export type LocationProps = {
	// If true, then we'll publish our position to the broadcast.
	enabled?: boolean;

	// Our initial position.
	current?: Catalog.Position;

	// If true, then this broadcaster allows other peers to request position updates.
	peering?: boolean;
};

export class Location {
	broadcast: Moq.BroadcastProducer;

	enabled: Signal<boolean>;

	current: Signal<Catalog.Position | undefined>;
	peering: Signal<boolean | undefined>;

	#track = new Moq.TrackProducer("location.json", 0);
	#producer = new Container.PositionProducer(this.#track);

	catalog = new Signal<Catalog.Location | undefined>(undefined);

	#peers = new Signal<Record<string, Catalog.Track> | undefined>(undefined);

	#signals = new Effect();

	constructor(broadcast: Moq.BroadcastProducer, props?: LocationProps) {
		this.broadcast = broadcast;

		this.enabled = new Signal(props?.enabled ?? false);
		this.current = new Signal(props?.current ?? undefined);
		this.peering = new Signal(props?.peering ?? undefined);

		this.#signals.effect((effect) => {
			const enabled = effect.get(this.enabled);
			if (!enabled) {
				return;
			}

			broadcast.insertTrack(this.#track.consume());
			effect.cleanup(() => broadcast.removeTrack(this.#track.name));

			effect.set(
				this.catalog,
				{
					initial: this.current.peek(), // Doesn't trigger a re-render
					updates: { name: this.#track.name, priority: u8(this.#track.priority) },
					peering: effect.get(this.peering),
					peers: effect.get(this.#peers),
				},
				undefined,
			);
		});

		this.#signals.effect((effect) => {
			const position = effect.get(this.current);
			if (!position) return;
			this.#producer.update(position);
		});
	}

	// Request that a peer update their position via their handle.
	peer(handle?: string): LocationPeer {
		return new LocationPeer(this.broadcast, this.#peers, handle);
	}

	close() {
		this.#producer.close();
		this.#signals.close();
	}
}

export class LocationPeer {
	handle: Signal<string | undefined>;
	catalog: Signal<Record<string, Catalog.Track> | undefined>;
	broadcast: Moq.BroadcastProducer;
	//location: Signal<Catalog.Position | undefined>
	producer = new Signal<Container.PositionProducer | undefined>(undefined);

	#signals = new Effect();

	constructor(
		broadcast: Moq.BroadcastProducer,
		catalog: Signal<Record<string, Catalog.Track> | undefined>,
		handle?: string,
	) {
		this.handle = new Signal(handle);
		this.catalog = catalog;
		this.broadcast = broadcast;

		this.#signals.effect((effect) => {
			const handle = effect.get(this.handle);
			if (!handle) {
				return;
			}

			const track = new Moq.TrackProducer(`peer/${handle}/location.json`, 0);
			effect.cleanup(() => track.close());

			broadcast.insertTrack(track.consume());
			effect.cleanup(() => broadcast.removeTrack(track.name));

			this.catalog.set((prev) => {
				return {
					...(prev ?? {}),
					[handle]: {
						name: track.name,
						priority: u8(track.priority),
					},
				};
			});

			effect.cleanup(() => {
				this.catalog.set((prev) => {
					const { [handle]: _, ...rest } = prev ?? {};
					return {
						...rest,
					};
				});
			});

			const producer = new Container.PositionProducer(track);
			effect.cleanup(() => producer.close());

			effect.set(this.producer, producer);
		});
	}

	close() {
		this.#signals.close();
	}
}
