import type * as Moq from "@kixelated/moq";
import * as Zod from "@kixelated/moq/zod";
import { Effect, type Getter, Signal } from "@kixelated/signals";
import * as Catalog from "../catalog";

export interface LocationProps {
	enabled?: boolean | Signal<boolean>;
}

export class Location {
	enabled: Signal<boolean>;

	broadcast: Signal<Moq.BroadcastConsumer | undefined>;
	catalog = new Signal<Catalog.Location | undefined>(undefined);
	handle = new Signal<string | undefined>(undefined);

	#current = new Signal<Catalog.Position | undefined>(undefined);
	readonly current: Getter<Catalog.Position | undefined> = this.#current;

	#updates = new Signal<Catalog.Track | undefined>(undefined);

	#signals = new Effect();

	constructor(
		broadcast: Signal<Moq.BroadcastConsumer | undefined>,
		catalog: Signal<Catalog.Root | undefined>,
		props?: LocationProps,
	) {
		this.enabled = Signal.from(props?.enabled ?? false);
		this.broadcast = broadcast;

		// Grab the location section from the catalog (if it's changed).
		this.#signals.effect((effect) => {
			if (!effect.get(this.enabled)) return;
			this.catalog.set(effect.get(catalog)?.location);
		});

		this.#signals.effect((effect) => {
			this.handle.set(effect.get(this.catalog)?.handle);
		});

		// TODO This seems kinda wrong and racy
		this.#signals.effect((effect) => {
			const catalog = effect.get(this.catalog);
			if (!catalog) return;

			const initial = catalog.initial;
			if (!initial) return;

			this.#current.set(initial);
		});

		this.#signals.effect((effect) => {
			const broadcast = effect.get(this.broadcast);
			const catalog = effect.get(this.catalog);
			const updates = catalog?.updates;

			if (!broadcast || !catalog || !updates) return;
			effect.set(this.#updates, updates);
		});

		this.#signals.effect((effect) => {
			const broadcast = effect.get(this.broadcast);
			if (!broadcast) return;

			const updates = effect.get(this.#updates);
			if (!updates) return;

			const track = broadcast.subscribe(updates.name, updates.priority);
			effect.cleanup(() => track.close());

			effect.spawn(runConsumer.bind(this, track, this.#current));
		});
	}

	// Request the location from a specific peer.
	peer(handle?: string): LocationPeer {
		return new LocationPeer(this.broadcast, this.catalog, handle);
	}

	close() {
		this.#signals.close();
	}
}

async function runConsumer(
	consumer: Moq.TrackConsumer,
	location: Signal<Catalog.Position | undefined>,
	cancel: Promise<void>,
) {
	try {
		for (;;) {
			const position = await Promise.race([Zod.read(consumer, Catalog.PositionSchema), cancel]);
			if (!position) break;

			location.set(position);
		}

		location.set(undefined);
	} catch (err) {
		console.warn("error running location consumer", err);
	} finally {
		consumer.close();
	}
}

export class LocationPeer {
	handle: Signal<string | undefined>;
	location: Signal<Catalog.Position | undefined>;
	broadcast: Signal<Moq.BroadcastConsumer | undefined>;

	#track = new Signal<Catalog.Track | undefined>(undefined);
	#signals = new Effect();

	constructor(
		broadcast: Signal<Moq.BroadcastConsumer | undefined>,
		catalog: Getter<Catalog.Location | undefined>,
		handle?: string,
	) {
		this.handle = Signal.from(handle);
		this.location = new Signal<Catalog.Position | undefined>(undefined);
		this.broadcast = broadcast;

		this.#signals.effect((effect) => {
			const handle = effect.get(this.handle);
			if (!handle) return;

			const root = effect.get(catalog);
			if (!root) return;

			const track = root.peers?.[handle];
			if (!track) return;

			effect.set(this.#track, track);
		});

		this.#signals.effect(this.#run.bind(this));
	}

	#run(effect: Effect): void {
		effect.cleanup(() => this.location.set(undefined));

		const broadcast = effect.get(this.broadcast);
		if (!broadcast) return;

		const track = effect.get(this.#track);
		if (!track) return;

		const sub = broadcast.subscribe(track.name, track.priority);
		effect.cleanup(() => sub.close());

		effect.spawn(runConsumer.bind(this, sub, this.location));
	}

	close() {
		this.#signals.close();
	}
}
