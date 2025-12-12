import { Publish, Watch } from "@moq/hang";
import type * as Moq from "@moq/lite";
import { Effect, Signal } from "@moq/signals";
import type { Broadcast } from "./broadcast";
import type { Canvas } from "./canvas";
import type { Local } from "./local";
import { Locator } from "./locator";
import type { Sound } from "./sound";
import { Space } from "./space";

export { Settings } from "./settings";

export interface RoomProps {
	connection: Moq.Connection.Reload;
	canvas: Canvas;
	sound: Sound;
	local: Local;
}

export class Room {
	// The connection to the server.
	// This is reactive; it may still be pending.
	connection: Moq.Connection.Reload;

	// The local broadcasts.
	// The camera/avatar is always published while the screen share is conditionally published.
	local: Local;

	// The physics space for the room.
	space: Space;

	#cameraBroadcast = new Signal<Broadcast<Publish.Broadcast> | undefined>(undefined);
	#shareBroadcast = new Signal<Broadcast<Publish.Broadcast> | undefined>(undefined);

	#signals = new Effect();

	constructor(props: RoomProps) {
		this.connection = props.connection;
		this.local = props.local;
		this.space = new Space(props.canvas, props.sound);

		this.#signals.effect((effect) => {
			const connection = effect.get(this.connection.established);
			if (!connection) return;

			const announced = connection.announced();
			effect.cleanup(() => announced.close());

			effect.spawn(this.#run.bind(this, announced));
			effect.cleanup(() => {
				const all = this.space.clear();
				for (const broadcast of all) {
					broadcast.close();
					if (!(broadcast.source instanceof Publish.Broadcast)) {
						broadcast.source.close();
					}
				}
			});
		});

		// Manage the locator for the camera broadcast
		this.#signals.effect((effect) => {
			const cameraBroadcast = effect.get(this.#cameraBroadcast);
			if (!cameraBroadcast) return;

			const locator = new Locator(cameraBroadcast);
			effect.cleanup(() => locator.close());

			// Auto-close after 8 seconds (7s visible + 1s fade transition)
			effect.timer(() => locator.close(), 8000);
		});

		// Manage the locator for the share broadcast
		this.#signals.effect((effect) => {
			const shareBroadcast = effect.get(this.#shareBroadcast);
			if (!shareBroadcast) return;

			const locator = new Locator(shareBroadcast);
			effect.cleanup(() => locator.close());

			// Auto-close after 8 seconds (7s visible + 1s fade transition)
			effect.timer(() => locator.close(), 8000);
		});
	}

	async #run(announced: Moq.Announced) {
		for (;;) {
			const update = await announced.next();
			if (!update) break;

			if (update.path === this.local.camera.path.peek()) {
				if (update.active) {
					const broadcast = this.space.add(update.path, this.local.camera);
					this.#cameraBroadcast.set(broadcast as Broadcast<Publish.Broadcast>);
				} else {
					this.space.remove(update.path);
					this.#cameraBroadcast.set(undefined);
				}

				continue;
			}

			if (update.path === this.local.share.path.peek()) {
				if (update.active) {
					const broadcast = this.space.add(update.path, this.local.share);
					this.#shareBroadcast.set(broadcast as Broadcast<Publish.Broadcast>);
				} else {
					this.space.remove(update.path);
					this.#shareBroadcast.set(undefined);
				}

				continue;
			}

			if (update.active) {
				this.#addRemote(update.path);
			} else {
				this.space.remove(update.path).then((broadcast) => broadcast.close());
			}
		}
	}

	#addRemote(path: Moq.Path.Valid) {
		const watch = new Watch.Broadcast({
			connection: this.connection.established,
			enabled: true,
			path,
			reload: false,
			// Download the location of the broadcaster.
			location: {
				window: { enabled: true },
				peers: { enabled: true },
			},
			chat: {
				// Download the chat of the broadcaster.
				message: { enabled: true },
				// And download the typing indicator.
				typing: { enabled: true },
			},
			// Download the preview track to receive high-level information about the broadcaster.
			preview: { enabled: true },
			audio: {
				enabled: this.space.sound.enabled,
			},
			// Download the user information.
			user: {
				enabled: true,
			},
			video: {
				enabled: this.space.canvas.visible,
			},
		});

		// Request the position we should use from this remote broadcast.
		watch.signals.effect((effect) => {
			const positions = effect.get(watch.location.peers.positions);
			if (!positions) return;

			// Check if our local handles are in the positions.
			const camera = effect.get(this.local.camera.location.window.handle);
			const screen = effect.get(this.local.share.location.window.handle);

			// TODO Only update if it's not the same as the previous position.

			if (camera && camera in positions) {
				const position = positions[camera];
				this.local.camera.location.window.position.update((prev) => ({ ...prev, ...position }));
			}

			if (screen && screen in positions) {
				const position = positions[screen];
				this.local.share.location.window.position.update((prev) => ({ ...prev, ...position }));
			}
		});

		this.space.add(path, watch);
	}

	close() {
		this.#signals.close();
		this.space.close();
	}
}
