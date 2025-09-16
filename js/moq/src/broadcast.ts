import { Signal } from "@kixelated/signals";
import { type TrackConsumer, TrackProducer } from "./track.ts";

interface BroadcastState {
	tracks: Map<string, TrackConsumer>;
	closed: boolean | Error;
	consumers: number;
	onUnknown?: (track: TrackProducer) => void;
}

/**
 * Handles writing and managing tracks in a broadcast.
 *
 * @public
 */
export class BroadcastProducer {
	#state: Signal<BroadcastState>;

	static #finalizer = new FinalizationRegistry(() => {
		console.warn("BroadcastProducer was garbage collected without being closed");
	});

	/**
	 * @internal
	 */
	constructor() {
		this.#state = new Signal<BroadcastState>({
			tracks: new Map(),
			closed: false,
			consumers: 0,
			onUnknown: undefined,
		});

		BroadcastProducer.#finalizer.register(this, undefined, this);
	}

	/**
	 * Creates a new track with the specified name.
	 * @param name - The name of the track to create
	 * @returns A TrackProducer for the new track
	 */
	createTrack(name: string): TrackProducer {
		if (this.#state.peek().closed) throw new Error(`broadcast is closed: ${this.#state.peek().closed}`);

		const track = new TrackProducer(name, 0);
		this.insertTrack(track.consume());
		return track;
	}

	/**
	 * Inserts an existing track into the broadcast.
	 * @param track - The track reader to insert
	 */
	insertTrack(track: TrackConsumer) {
		if (this.#state.peek().closed) throw new Error(`broadcast is closed: ${this.#state.peek().closed}`);

		this.#state.mutate((state) => {
			state.tracks.get(track.name)?.close();
			state.tracks.set(track.name, track);
		});
	}

	/**
	 * Removes a track from the broadcast.
	 * @param name - The name of the track to remove
	 */
	removeTrack(name: string) {
		this.#state.mutate((state) => {
			const track = state.tracks.get(name);
			track?.close();
			state.tracks.delete(name);
		});
	}

	/**
	 * Sets a callback for handling unknown (on-demand) tracks.
	 * If not specified, unknown tracks will be closed with a "not found" error.
	 *
	 * @param fn - The callback function to handle unknown tracks
	 */
	unknownTrack(fn?: (track: TrackProducer) => void) {
		this.#state.mutate((state) => {
			state.onUnknown = fn;
		});
	}

	/**
	 * Closes the writer and all associated tracks.
	 *
	 * @param abort - If provided, throw this exception instead of returning undefined.
	 */
	close(abort?: Error) {
		if (!BroadcastProducer.#finalizer.unregister(this)) return;

		this.#state.mutate((state) => {
			state.closed = abort ?? true;

			for (const track of state.tracks.values()) {
				track.close();
			}
			state.tracks.clear();
		});
	}

	async closed(): Promise<Error | undefined> {
		const closed = await this.#state.until((state) => !!state.closed);
		return closed instanceof Error ? closed : undefined;
	}

	/**
	 * Returns a promise that resolves when the writer is unused.
	 */
	async unused(): Promise<void> {
		await this.#state.until((state) => !!state.closed || state.consumers <= 0);
	}

	consume(): BroadcastConsumer {
		return new BroadcastConsumer(this.#state);
	}
}

/**
 * Handles reading and subscribing to tracks in a broadcast.
 *
 * @remarks `clone()` can be used to create multiple consumers, just remember to `close()` them.
 *
 * @public
 */
export class BroadcastConsumer {
	#state: Signal<BroadcastState>;

	static #finalizer = new FinalizationRegistry(() => {
		console.warn("BroadcastConsumer was garbage collected without being closed");
	});

	/**
	 * @internal
	 */
	constructor(state: Signal<BroadcastState>) {
		this.#state = state;
		BroadcastConsumer.#finalizer.register(this, undefined, this);
		this.#state.mutate((state) => {
			state.consumers++;
		});
	}

	/**
	 * Subscribes to a track with the specified priority.
	 * @param track - The name of the track to subscribe to
	 * @param priority - The priority level for the subscription
	 * @returns A TrackConsumer for the subscribed track
	 */
	subscribe(track: string, priority: number): TrackConsumer {
		if (this.#state.peek().closed) {
			throw new Error(`broadcast is closed: ${this.#state.peek().closed}`);
		}

		const existing = this.#state.peek().tracks.get(track);
		if (existing) {
			return existing.clone();
		}

		const producer = new TrackProducer(track, priority);
		const consumer = producer.consume();

		const onUnknown = this.#state.peek().onUnknown;
		if (onUnknown) {
			onUnknown(producer);
		} else {
			producer.close(new Error("not found"));
		}

		return consumer;
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
	 * Closes the reader.
	 */
	close() {
		if (!BroadcastConsumer.#finalizer.unregister(this)) return;
		this.#state.mutate((state) => {
			state.consumers--;
		});
	}

	/**
	 * Creates a new instance of the reader using the same state.
	 * @returns A new BroadcastConsumer instance
	 */
	clone(): BroadcastConsumer {
		return new BroadcastConsumer(this.#state);
	}
}
