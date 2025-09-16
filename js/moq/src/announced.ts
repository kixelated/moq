import { Signal } from "@kixelated/signals";
import * as Path from "./path.ts";

/**
 * The availability of a broadcast.
 *
 * @public
 */
export interface Announce {
	name: Path.Valid;
	active: boolean;
}

interface AnnouncedState {
	queue: Announce[];
	closed: boolean | Error;
	consumers: number;
}

/**
 * Handles writing announcements to the announcement queue.
 *
 * @public
 */
export class AnnouncedProducer {
	#state: Signal<AnnouncedState>;

	static #finalizer = new FinalizationRegistry(() => {
		console.warn("AnnouncedProducer was garbage collected without being closed");
	});

	constructor() {
		this.#state = new Signal<AnnouncedState>({
			queue: [],
			closed: false,
			consumers: 0,
		});

		AnnouncedProducer.#finalizer.register(this, undefined, this);
	}

	/**
	 * Writes an announcement to the queue.
	 * @param announcement - The announcement to write
	 */
	write(announcement: Announce) {
		if (this.#state.peek().closed) throw new Error("announced is closed");
		this.#state.mutate((state) => {
			state.queue.push(announcement);
		});
	}

	/**
	 * Closes the writer.
	 * @param abort - If provided, throw this exception instead of returning undefined.
	 */
	close(abort?: Error) {
		if (!AnnouncedProducer.#finalizer.unregister(this)) return;
		this.#state.mutate((state) => {
			state.closed = abort ?? true;
		});
	}

	/**
	 * Returns a promise that resolves when the writer is closed.
	 * @returns A promise that resolves when closed
	 */
	async closed(): Promise<Error | undefined> {
		const closed = await this.#state.until((state) => !!state.closed);
		return closed instanceof Error ? closed : undefined;
	}

	async unused(): Promise<void> {
		await this.#state.until((state) => !!state.closed || state.consumers <= 0);
	}

	/**
	 * Creates a new AnnouncedConsumer that only returns the announcements for the specified prefix.
	 * @param prefix - The prefix for the consumer
	 * @returns A new AnnouncedConsumer instance
	 */
	consume(prefix = Path.empty()): AnnouncedConsumer {
		return new AnnouncedConsumer(prefix, this.#state);
	}
}

/**
 * Handles reading announcements from the announcement queue.
 *
 * @public
 */
export class AnnouncedConsumer {
	/** The prefix for this reader */
	readonly prefix: Path.Valid;

	#state: Signal<AnnouncedState>;
	#index = 0;

	static #finalizer = new FinalizationRegistry<Path.Valid>((prefix) => {
		console.warn("AnnouncedConsumer was garbage collected without being closed", prefix);
	});

	/**
	 * Creates a new AnnounceConsumer with the specified prefix and queue.
	 * @param prefix - The prefix for the reader
	 * @param queue - The queue to read announcements from
	 *
	 * @internal
	 */
	constructor(prefix: Path.Valid, state: Signal<AnnouncedState>) {
		this.#state = state;
		this.prefix = prefix;

		AnnouncedConsumer.#finalizer.register(this, prefix, this);
		this.#state.mutate((state) => {
			state.consumers++;
		});
	}

	/**
	 * Returns the next announcement from the queue.
	 * @returns A promise that resolves to the next announcement or undefined
	 */
	async next(): Promise<Announce | undefined> {
		for (;;) {
			const state = await this.#state.until((state) => !!state.closed || state.queue.length > this.#index);
			if (state.closed instanceof Error) throw state.closed;
			if (state.closed) return undefined;

			while (this.#index < state.queue.length) {
				const announce = state.queue.at(this.#index++);
				if (!announce) continue;

				// Check if name starts with prefix and respects path boundaries
				// We remove the prefix so we only return our suffix.
				const suffix = Path.stripPrefix(this.prefix, announce.name);
				if (suffix === null) continue;

				return {
					name: suffix,
					active: announce.active,
				};
			}
		}
	}

	/**
	 * Closes the reader.
	 */
	close() {
		if (!AnnouncedConsumer.#finalizer.unregister(this)) return;
		this.#state.mutate((state) => {
			state.consumers--;
		});
	}

	/**
	 * Returns a promise that resolves when the reader is closed.
	 * @returns A promise that resolves when closed
	 */
	async closed(): Promise<Error | undefined> {
		const closed = await this.#state.until((state) => !!state.closed);
		return closed instanceof Error ? closed : undefined;
	}

	/**
	 * Creates a new instance of the reader using the same queue and prefix.
	 *
	 * @returns A new AnnounceConsumer instance
	 */
	clone(): AnnouncedConsumer {
		return new AnnouncedConsumer(this.prefix, this.#state);
	}
}
