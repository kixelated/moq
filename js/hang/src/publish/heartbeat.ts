import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import type * as Catalog from "../catalog";
import { u8 } from "../catalog/integers";

const INTERVAL = 1000;

export type HeartbeatProps = {
	enabled?: boolean;
};

export class Heartbeat {
	broadcast: Moq.BroadcastProducer;
	enabled: Signal<boolean>;
	catalog = new Signal<Catalog.Heartbeat | undefined>(undefined);

	#track = new Moq.TrackProducer("heartbeat", 0);
	#counter = 0;
	#interval: ReturnType<typeof setInterval>;

	#signals = new Effect();

	constructor(broadcast: Moq.BroadcastProducer, props?: HeartbeatProps) {
		this.broadcast = broadcast;
		this.enabled = new Signal(props?.enabled ?? false);

		// Always encode the heartbeat even when not enabled.
		// It's just a LOT easier.
		this.#send();
		this.#interval = setInterval(() => {
			this.#send();
		}, INTERVAL);

		this.#signals.effect((effect) => {
			const enabled = effect.get(this.enabled);
			if (!enabled) return;

			broadcast.insertTrack(this.#track.consume());
			effect.cleanup(() => broadcast.removeTrack(this.#track.name));

			this.catalog.set({
				track: { name: this.#track.name, priority: u8(this.#track.priority) },
			});
		});
	}

	#send() {
		const data = this.#encode(this.#counter);
		const group = this.#track.appendGroup();
		group.writeFrame(data);
		group.close();

		this.#counter++;
	}

	#encode(value: number): Uint8Array {
		if (value < 256) {
			return new Uint8Array([value]);
		} else if (value < 65536) {
			const buffer = new ArrayBuffer(2);
			new DataView(buffer).setUint16(0, value, false); // big-endian
			return new Uint8Array(buffer);
		} else if (value < 4294967296) {
			const buffer = new ArrayBuffer(4);
			new DataView(buffer).setUint32(0, value, false); // big-endian
			return new Uint8Array(buffer);
		} else {
			const buffer = new ArrayBuffer(8);
			new DataView(buffer).setBigUint64(0, BigInt(value), false);
			return new Uint8Array(buffer);
		}
	}

	close() {
		this.#signals.close();
		clearInterval(this.#interval);
	}
}
