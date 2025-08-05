import type * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import type * as Catalog from "../catalog";

const INTERVAL = 1000;

export interface HeartbeatProps {
	enabled?: boolean;
	timeout?: number; // in milliseconds, defaults to 200ms
}

export class Heartbeat {
	broadcast: Signal<Moq.BroadcastConsumer | undefined>;
	enabled: Signal<boolean>;
	alive = new Signal<boolean | undefined>(undefined);

	#signals = new Effect();
	#timeout: number;

	constructor(
		broadcast: Signal<Moq.BroadcastConsumer | undefined>,
		catalog: Signal<Catalog.Root | undefined>,
		props?: HeartbeatProps,
	) {
		this.broadcast = broadcast;
		this.enabled = new Signal(props?.enabled ?? false);
		this.#timeout = props?.timeout ?? 200;

		this.#signals.effect((effect) => {
			if (!effect.get(this.enabled)) return;

			const heartbeat = effect.get(catalog)?.heartbeat;
			if (!heartbeat) return;

			const broadcast = effect.get(this.broadcast);
			if (!broadcast) return;

			const track = broadcast.subscribe(heartbeat.track.name, heartbeat.track.priority);
			effect.cleanup(() => track.clone());

			effect.spawn(async (cancel) => {
				for (;;) {
					let timeout: ReturnType<typeof setTimeout> | undefined;
					const timer = new Promise<"timeout">((resolve) => {
						timeout = setTimeout(() => resolve("timeout"), INTERVAL + this.#timeout);
					});

					let frame = await Promise.race([track.nextFrame(), timer, cancel]);
					if (frame === "timeout") {
						this.alive.set(false);
						frame = await Promise.race([track.nextFrame(), cancel]);
					} else {
						clearTimeout(timeout);
					}

					if (!frame) break;

					this.#decode(frame.data); // TODO actually use the value?
					this.alive.set(true);
				}
			});

			effect.cleanup(() => {
				this.alive.set(undefined);
			});
		});
	}

	#decode(data: Uint8Array): number {
		if (data.length === 1) {
			return data[0];
		} else if (data.length === 2) {
			return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(0, false); // big-endian
		} else if (data.length === 4) {
			return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, false); // big-endian
		} else {
			throw new Error(`Invalid heartbeat data length: ${data.length}`);
		}
	}

	close() {
		this.#signals.close();
	}
}
