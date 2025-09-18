import { Path } from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import { type Moq, type Publish, Watch } from "..";

export type Broadcast = Watch.Broadcast | Publish.Broadcast;

export type RoomProps = {
	connection: Moq.Connection.Established | Signal<Moq.Connection.Established | undefined>;
	name?: Path.Valid | Signal<Path.Valid | undefined>;
};

export class Room {
	// The connection to the server.
	connection: Signal<Moq.Connection.Established | undefined>;

	// An optional prefix to filter broadcasts by.
	name: Signal<Path.Valid | undefined>;

	// The active broadcasts, sorted by announcement time.
	active = new Map<Path.Valid, Broadcast>();

	// All of the remote broadcasts.
	remotes = new Map<Path.Valid, Watch.Broadcast>();

	// The local broadcasts.
	locals = new Map<Path.Valid, Publish.Broadcast>();

	// Optional callbacks to learn when individual broadcasts are added/removed.
	// We avoid using signals because we don't want to re-render everything on every update.
	// One day I'll figure out how to handle collections elegantly.
	#onActive?: (name: Path.Valid, broadcast: Broadcast | undefined) => void;
	#onRemote?: (name: Path.Valid, broadcast: Watch.Broadcast | undefined) => void;
	#onLocal?: (name: Path.Valid, broadcast: Publish.Broadcast | undefined) => void;

	#signals = new Effect();

	constructor(props?: RoomProps) {
		this.connection = Signal.from(props?.connection);
		this.name = Signal.from(props?.name);

		this.#signals.effect(this.#init.bind(this));
	}

	// Render a local broadcast instead of downloading a remote broadcast.
	// This is not a perfect preview, as downloading/decoding is skipped.
	// NOTE: The broadcast is only published when broadcast.enabled is true.
	preview(name: Path.Valid, broadcast: Publish.Broadcast) {
		this.locals.set(name, broadcast);
	}

	unpreview(name: Path.Valid) {
		this.locals.delete(name);
	}

	// Register a callback when a broadcast has been added/removed.
	onActive(callback?: (name: Path.Valid, broadcast: Broadcast | undefined) => void) {
		this.#onActive = callback;
		if (!callback) return;

		for (const [name, broadcast] of this.active) {
			callback(name, broadcast);
		}
	}

	onRemote(callback?: (name: Path.Valid, broadcast: Watch.Broadcast | undefined) => void) {
		this.#onRemote = callback;
		if (!callback) return;

		for (const [name, broadcast] of this.remotes) {
			callback(name, broadcast);
		}
	}

	onLocal(callback?: (name: Path.Valid, broadcast: Publish.Broadcast | undefined) => void) {
		this.#onLocal = callback;
		if (!callback) return;

		for (const [name, broadcast] of this.locals) {
			callback(name, broadcast);
		}
	}

	#init(effect: Effect) {
		const connection = effect.get(this.connection);
		if (!connection) return;

		const url = connection.url;
		if (!url) return;

		const name = effect.get(this.name);

		const announced = connection.announced(name);
		effect.cleanup(() => announced.close());

		effect.spawn(async () => {
			for (;;) {
				const update = await announced.next();
				if (!update) break;

				this.#handleUpdate(update);
			}
		});
	}

	#handleUpdate(update: Moq.AnnouncedEntry) {
		for (const [name, broadcast] of this.locals) {
			if (update.name === name) {
				if (update.active) {
					this.active.set(update.name, broadcast);
					this.#onLocal?.(update.name, broadcast);
					this.#onActive?.(update.name, broadcast);
				} else {
					this.active.delete(update.name);
					this.#onLocal?.(update.name, undefined);
					this.#onActive?.(update.name, undefined);
				}
				return;
			}
		}

		if (update.active) {
			// NOTE: If you were implementing this yourself, you could use the <hang-watch> element instead.
			const watch = new Watch.Broadcast({
				connection: this.connection,
				// NOTE: You're responsible for setting enabled to true if you want to download the broadcast.
				enabled: false,
				name: update.name,
				reload: false,
			});

			this.remotes.set(update.name, watch);
			this.active.set(update.name, watch);

			this.#onRemote?.(update.name, watch);
			this.#onActive?.(update.name, watch);
		} else {
			const existing = this.remotes.get(update.name);
			if (!existing) throw new Error(`broadcast not found: ${update.name}`);

			existing.close();
			this.remotes.delete(update.name);
			this.active.delete(update.name);

			this.#onRemote?.(update.name, undefined);
			this.#onActive?.(update.name, undefined);
		}
	}

	close() {
		this.#signals.close();

		// Swap out the maps so they're empty when the callbacks run.
		const remotes = this.remotes;
		const active = this.active;
		const locals = this.locals;

		this.remotes = new Map();
		this.active = new Map();
		this.locals = new Map();

		// Clear all remote/active broadcasts when there are no more announcements.
		for (const [name, broadcast] of remotes) {
			broadcast.close();
			this.#onRemote?.(name, undefined);
		}

		for (const name of locals.keys()) {
			this.#onLocal?.(name, undefined);
		}

		for (const name of active.keys()) {
			this.#onActive?.(name, undefined);
		}
	}
}
