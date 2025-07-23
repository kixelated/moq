import * as Moq from "@kixelated/moq";
import { type Computed, type Effect, Root, Signal } from "@kixelated/signals";
import type * as Catalog from "../catalog";
import { u8 } from "../catalog/integers";
import * as Container from "../container";

export type ChatProps = {
	enabled?: boolean;

	// If provided, chat messages are only kept for this duration.
	ttl?: DOMHighResTimeStamp;
};

export class Chat {
	broadcast: Moq.BroadcastProducer;
	enabled: Signal<boolean>;
	message: Signal<string | undefined>;

	// NOTE: Only applies to new messages.
	ttl: Signal<DOMHighResTimeStamp | undefined>;

	catalog: Computed<Catalog.Chat | undefined>;

	// Always create the track, even if we're not publishing it
	#track = new Moq.TrackProducer("chat.md", 0);
	#signals = new Root();

	constructor(broadcast: Moq.BroadcastProducer, props?: ChatProps) {
		this.broadcast = broadcast;
		this.enabled = new Signal(props?.enabled ?? false);
		this.ttl = new Signal(props?.ttl);
		this.message = new Signal<string | undefined>(undefined);

		this.catalog = this.#signals.computed<Catalog.Chat | undefined>((effect: Effect) => {
			const enabled = effect.get(this.enabled);
			if (!enabled) return;

			broadcast.insertTrack(this.#track.consume());
			effect.cleanup(() => broadcast.removeTrack(this.#track.name));

			return { track: { name: this.#track.name, priority: u8(this.#track.priority) }, ttl: effect.get(this.ttl) };
		});

		this.#signals.effect((effect) => {
			const message = effect.get(this.message);
			if (!message) {
				// Create an empty group to uncache the previous group.
				const group = this.#track.appendGroup();
				group.close();
				return;
			}

			// Convert the text to a buffer
			const encoder = new TextEncoder();
			const buffer = encoder.encode(message);

			// We currently only support a single message per group, which is kind of sad.
			// TODO support multiple messages on the wire.
			const group = this.#track.appendGroup();
			group.writeFrame(buffer);
			group.close();

			const expires = window.setTimeout(() => {
				this.message.set(undefined);
			}, this.ttl.peek());

			effect.cleanup(() => clearTimeout(expires));
		});
	}

	// Optionally consume our published messages for local playback.
	consume(): Container.ChatConsumer {
		return new Container.ChatConsumer(this.#track.consume());
	}

	close() {
		this.#signals.close();
	}
}
