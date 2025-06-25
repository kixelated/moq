import * as Moq from "@kixelated/moq";
import { type Computed, type Effect, Root, Signal } from "@kixelated/signals";
import type * as Catalog from "../catalog";
import * as Container from "../container";

export type ChatProps = {
	enabled?: boolean;

	// If provided, chat messages are only kept for this duration.
	ttl?: DOMHighResTimeStamp;
};

export class Chat {
	broadcast: Moq.BroadcastProducer;
	enabled: Signal<boolean>;

	// NOTE: Only applies to new messages.
	ttl: Signal<DOMHighResTimeStamp | undefined>;

	catalog: Computed<Catalog.Chat | undefined>;

	// Always create the track, even if we're not publishing it
	#track = new Moq.TrackProducer("chat.md", 0);
	#group?: Moq.GroupProducer;
	#expires?: number;

	#signals = new Root();

	constructor(broadcast: Moq.BroadcastProducer, props?: ChatProps) {
		this.broadcast = broadcast;
		this.enabled = new Signal(props?.enabled ?? false);
		this.ttl = new Signal(props?.ttl);

		this.catalog = this.#signals.computed<Catalog.Chat | undefined>((effect: Effect) => {
			const enabled = effect.get(this.enabled);
			if (!enabled) return;

			broadcast.insertTrack(this.#track.consume());
			effect.cleanup(() => broadcast.removeTrack(this.#track.name));

			return { track: { name: this.#track.name, priority: this.#track.priority }, ttl: effect.get(this.ttl) };
		});
	}

	// Publish a message to the chat, using the current time as the timestamp.
	publish(text: string) {
		// Convert the text to a buffer
		const encoder = new TextEncoder();
		const buffer = encoder.encode(text);

		if (this.#expires) {
			clearTimeout(this.#expires);
		}

		// We currently only support a single message per group, which is kind of sad.
		// TODO support multiple messages on the wire.
		this.#group?.close();
		this.#group = this.#track.appendGroup();
		this.#group.writeFrame(buffer);

		// Clear the group after the TTL.
		const ttl = this.ttl.peek();
		if (ttl) {
			this.#expires = window.setTimeout(() => this.clear(), ttl);
		}
	}

	// Optionally consume our published messages for local playback.
	consume(): Container.ChatConsumer {
		return new Container.ChatConsumer(this.#track.consume());
	}

	clear() {
		this.#group?.close();

		// We create a new group with no frames to uncache the previous group.
		this.#group = this.#track.appendGroup();
	}

	close() {
		this.#group?.close();
		this.#signals.close();

		if (this.#expires) {
			clearTimeout(this.#expires);
		}
	}
}
