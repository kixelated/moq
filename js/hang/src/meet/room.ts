import { type Connection, type Moq, type Publish, Watch } from "@kixelated/hang";
import { type Effect, Root, Signal } from "@kixelated/signals";

export type Broadcast = Watch.Broadcast | Publish.Broadcast;

export type RoomProps = {
	path?: string;
};

export class Room {
	// The connection to the server.
	// This is reactive; it may still be pending.
	connection: Connection;

	// An optional path to append to the connection url.
	path: Signal<string>;

	// The active broadcasts, sorted by announcement time.
	active = new Map<string, Broadcast>();

	// All of the remote broadcasts.
	remotes = new Map<string, Watch.Broadcast>();

	// The local broadcasts.
	locals = new Map<string, Publish.Broadcast>();

	// Optional callbacks to learn when individual broadcasts are added/removed.
	// We avoid using signals because we don't want to re-render everything on every update.
	// One day I'll figure out how to handle collections elegantly.
	#onActive?: (path: string, broadcast: Broadcast | undefined) => void;
	#onRemote?: (path: string, broadcast: Watch.Broadcast | undefined) => void;
	#onLocal?: (path: string, broadcast: Publish.Broadcast | undefined) => void;

	#signals = new Root();

	constructor(connection: Connection, props?: RoomProps) {
		this.connection = connection;
		this.path = new Signal(props?.path ?? "");

		this.#signals.effect(this.#init.bind(this));
	}

	// Render a local broadcast instead of downloading a remote broadcast.
	// This is not a perfect preview, as downloading/decoding is skipped.
	// NOTE: The broadcast is only published when broadcast.enabled is true.
	preview(path: string, broadcast: Publish.Broadcast) {
		this.locals.set(path, broadcast);
	}

	unpreview(path: string) {
		this.locals.delete(path);
	}

	// Register a callback when a broadcast has been added/removed.
	onActive(callback?: (path: string, broadcast: Broadcast | undefined) => void) {
		this.#onActive = callback;
		if (!callback) return;

		for (const [path, broadcast] of this.active) {
			callback(path, broadcast);
		}
	}

	onRemote(callback?: (path: string, broadcast: Watch.Broadcast | undefined) => void) {
		this.#onRemote = callback;
		if (!callback) return;

		for (const [path, broadcast] of this.remotes) {
			callback(path, broadcast);
		}
	}

	onLocal(callback?: (path: string, broadcast: Publish.Broadcast | undefined) => void) {
		this.#onLocal = callback;
		if (!callback) return;

		for (const [path, broadcast] of this.locals) {
			callback(path, broadcast);
		}
	}

	#init(effect: Effect) {
		const url = effect.get(this.connection.url);
		if (!url) return;

		const connection = effect.get(this.connection.established);
		if (!connection) return;

		// Make sure the path ends with a slash so it's used as the room name.
		// Otherwise `path="de" would be a superset of `path="demo/", which is probably not what you want.
		// We also include the url because path is optional, and we need to make sure it ends with a slash too.
		// TODO add a slash to the URL on the server side instead?
		let path = effect.get(this.path);
		if (!`${url}${path}`.endsWith("/")) {
			path = `${path}/`;
		}

		const announced = connection.announced(path);
		effect.cleanup(() => announced.close());

		effect.spawn(this.#runRemotes.bind(this, announced));
	}

	async #runRemotes(announced: Moq.AnnouncedConsumer, cancel: Promise<void>) {
		try {
			for (;;) {
				const update = await Promise.race([announced.next(), cancel]);

				// We're donezo.
				if (!update) break;

				this.#handleUpdate(update);
			}
		} finally {
			this.close();
		}
	}

	#handleUpdate(update: Moq.Announce) {
		for (const [path, broadcast] of this.locals) {
			if (update.path === path) {
				if (update.active) {
					this.active.set(update.path, broadcast);
					this.#onLocal?.(update.path, broadcast);
					this.#onActive?.(update.path, broadcast);
				} else {
					this.active.delete(update.path);
					this.#onLocal?.(update.path, undefined);
					this.#onActive?.(update.path, undefined);
				}
				return;
			}
		}

		if (update.active) {
			// NOTE: If you were implementing this yourself, you could use the <hang-watch> element instead.
			const watch = new Watch.Broadcast(this.connection, {
				// NOTE: You're responsible for setting enabled to true if you want to download the broadcast.
				enabled: false,
				path: update.path,
				reload: false,
			});

			this.remotes.set(update.path, watch);
			this.active.set(update.path, watch);

			this.#onRemote?.(update.path, watch);
			this.#onActive?.(update.path, watch);
		} else {
			const existing = this.remotes.get(update.path);
			if (!existing) throw new Error(`broadcast not found: ${update.path}`);

			existing.close();
			this.remotes.delete(update.path);
			this.active.delete(update.path);

			this.#onRemote?.(update.path, undefined);
			this.#onActive?.(update.path, undefined);
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
		for (const [path, broadcast] of remotes) {
			broadcast.close();
			this.#onRemote?.(path, undefined);
		}

		for (const path of locals.keys()) {
			this.#onLocal?.(path, undefined);
		}

		for (const path of active.keys()) {
			this.#onActive?.(path, undefined);
		}
	}
}
