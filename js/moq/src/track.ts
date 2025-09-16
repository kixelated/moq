import { Signal } from "@kixelated/signals";
import { type GroupConsumer, GroupProducer } from "./group.ts";

interface TrackState {
	group: GroupConsumer | undefined;
	closed: boolean | Error;
	consumers: number;
}

/**
 * Handles writing and managing groups in a track.
 *
 * @public
 */
export class TrackProducer {
	/** The name of the track */
	readonly name: string;
	/** The priority level of the track */
	readonly priority: number;

	#state: Signal<TrackState>;
	#next?: number;

	static #finalizer = new FinalizationRegistry<string>((name) => {
		console.warn("TrackProducer was garbage collected without being closed", name);
	});

	/**
	 * Creates a new TrackProducer with the specified name, priority, and latest group producer.
	 * @param name - The name of the track
	 * @param priority - The priority level
	 * @param latest - The latest group producer
	 *
	 * @internal
	 */
	constructor(name: string, priority?: number) {
		this.name = name;
		this.priority = priority ?? 0;

		this.#state = new Signal<TrackState>({
			group: undefined,
			closed: false,
			consumers: 0,
		});

		TrackProducer.#finalizer.register(this, name, this);
	}

	/**
	 * Appends a new group to the track.
	 * @returns A GroupProducer for the new group
	 */
	appendGroup(): GroupProducer {
		if (this.#state.peek().closed) throw new Error("track is closed");

		const group = new GroupProducer(this.#next ?? 0);

		this.#next = group.sequence + 1;
		this.#state.mutate((state) => {
			state.group?.close();
			state.group = group.consume();
		});

		return group;
	}

	/**
	 * Inserts an existing group into the track.
	 * @param group - The group to insert
	 */
	insertGroup(group: GroupConsumer) {
		if (this.#state.peek().closed) throw new Error("track is closed");

		if (group.sequence < (this.#next ?? 0)) {
			group.close();
			return;
		}

		this.#next = group.sequence + 1;
		this.#state.mutate((state) => {
			state.group?.close();
			state.group = group;
		});
	}

	/**
	 * Appends a frame to the track in its own group.
	 *
	 * @param frame - The frame to append
	 */
	writeFrame(frame: Uint8Array) {
		const group = this.appendGroup();
		group.writeFrame(frame);
		group.close();
	}

	writeString(str: string) {
		const group = this.appendGroup();
		group.writeString(str);
		group.close();
	}

	writeJson(json: unknown) {
		const group = this.appendGroup();
		group.writeJson(json);
		group.close();
	}

	writeBool(bool: boolean) {
		const group = this.appendGroup();
		group.writeBool(bool);
		group.close();
	}

	/**
	 * Closes the publisher and all associated groups.
	 */
	close(abort?: Error) {
		if (!TrackProducer.#finalizer.unregister(this)) return;

		this.#state.mutate((state) => {
			state.group?.close();
			state.closed = abort ?? true;
		});
	}

	async closed(): Promise<Error | undefined> {
		const closed = await this.#state.until((state) => !!state.closed);
		return closed instanceof Error ? closed : undefined;
	}

	/**
	 * Returns a promise that resolves when the publisher is unused.
	 * NOTE: Ignores the closed state while there are still active consumers.
	 *
	 * @returns A promise that resolves when unused
	 */
	async unused(): Promise<void> {
		await this.#state.until((state) => !!state.closed || state.consumers <= 0);
	}

	consume(): TrackConsumer {
		return new TrackConsumer(this.name, this.priority, this.#state);
	}
}

/**
 * Handles reading groups from a track.
 *
 * @public
 */
export class TrackConsumer {
	/** The name of the track */
	readonly name: string;
	/** The priority level of the track */
	readonly priority: number;

	#state: Signal<TrackState>;

	// State used for the nextFrame helper.
	#currentGroup?: GroupConsumer;
	#currentFrame = 0;

	#nextGroup: Promise<{ group: GroupConsumer | undefined }>;
	#nextFrame: Promise<{ frame: Uint8Array | undefined }>;

	static #finalizer = new FinalizationRegistry<string>((name) => {
		console.warn("TrackConsumer was garbage collected without being closed", name);
	});

	/**
	 * Creates a new TrackConsumer with the specified name, priority, and groups consumer.
	 * @param name - The name of the track
	 * @param priority - The priority level
	 * @param groups - The groups consumer
	 *
	 * @internal
	 */
	constructor(name: string, priority: number, state: Signal<TrackState>) {
		this.name = name;
		this.priority = priority;
		this.#state = state;

		this.#state.mutate((state) => {
			state.consumers++;
		});

		// Start fetching the next group immediately.
		this.#nextGroup = this.#fetchNextGroup();
		this.#nextFrame = this.#fetchNextFrame(undefined);

		TrackConsumer.#finalizer.register(this, name, this);
	}

	async #fetchNextGroup(): Promise<{ group: GroupConsumer | undefined }> {
		const state = await this.#state.until(
			(state) => !!state.closed || state.group?.sequence !== this.#currentGroup?.sequence,
		);
		if (state.group?.sequence !== this.#currentGroup?.sequence) return { group: state.group?.clone() };
		if (state.closed instanceof Error) throw state.closed;
		return { group: undefined };
	}

	async #fetchNextFrame(group?: GroupConsumer): Promise<{ frame: Uint8Array | undefined }> {
		if (!group) return { frame: undefined };
		return group
			.readFrame()
			.then((frame) => ({ frame }))
			.catch((error) => {
				console.warn("ignoring error reading frame", error);
				return { frame: undefined };
			});
	}

	/**
	 * Gets the next group from the track.
	 * @returns A promise that resolves to the next group or undefined
	 */
	async nextGroup(): Promise<GroupConsumer | undefined> {
		const next = await this.#nextGroup;

		// Start fetching the next group immediately.
		this.#nextGroup = this.#fetchNextGroup();

		// Update the state needed for the nextFrame() helper.
		this.#currentGroup?.close();
		this.#currentGroup = next?.group?.clone(); // clone so we don't steal from the returned consumer
		this.#currentFrame = 0;
		this.#nextFrame = this.#fetchNextFrame(this.#currentGroup);

		return next?.group;
	}

	/**
	 * A helper that returns the next frame in group order, skipping old groups/frames if needed.
	 *
	 * Returns the data and the index of the frame/group.
	 */
	async nextFrame(): Promise<{ group: number; frame: number; data: Uint8Array } | undefined> {
		for (;;) {
			const next = await this.#next();
			if (!next) return undefined;

			if ("frame" in next) {
				if (!this.#currentGroup) {
					throw new Error("impossible");
				}

				// Start reading the next frame.
				this.#nextFrame = this.#fetchNextFrame(this.#currentGroup);

				// Return the frame and increment the frame index.
				return { group: this.#currentGroup?.sequence, frame: this.#currentFrame++, data: next.frame };
			}

			this.#nextGroup = this.#fetchNextGroup();

			if (this.#currentGroup && this.#currentGroup.sequence >= next.group.sequence) {
				// Skip this old group.
				next.group.close();
				continue;
			}

			// Skip the rest of the current group.
			this.#currentGroup?.close();
			this.#currentGroup = next.group;
			this.#currentFrame = 0;

			// Start reading the next frame.
			this.#nextFrame = this.#fetchNextFrame(this.#currentGroup);
		}
	}

	async readFrame(): Promise<Uint8Array | undefined> {
		const next = await this.nextFrame();
		if (!next) return undefined;
		return next.data;
	}

	async readString(): Promise<string | undefined> {
		const next = await this.readFrame();
		if (!next) return undefined;
		return new TextDecoder().decode(next);
	}

	async readJson(): Promise<unknown | undefined> {
		const next = await this.readString();
		if (!next) return undefined;
		return JSON.parse(next);
	}

	async readBool(): Promise<boolean | undefined> {
		const next = await this.readFrame();
		if (!next) return undefined;
		if (next.byteLength !== 1 || !(next[0] === 0 || next[0] === 1)) throw new Error("invalid bool frame");
		return next[0] === 1;
	}

	// Returns the next non-undefined value from the nextFrame or nextGroup promises.
	async #next(): Promise<{ frame: Uint8Array } | { group: GroupConsumer } | undefined> {
		// The order matters here, because Promise.race returns the first resolved value *in order*.
		// This is also why we're not using Promise.any, because I think it works differently?
		const result = await Promise.race([this.#nextFrame, this.#nextGroup]);
		if ("frame" in result) {
			if (result.frame) {
				return { frame: result.frame };
			}

			const other = await this.#nextGroup;
			return other.group ? { group: other.group } : undefined;
		}

		if (result.group) {
			return { group: result.group };
		}

		const other = await this.#nextFrame;
		return other.frame ? { frame: other.frame } : undefined;
	}

	/**
	 * Creates a new instance of the consumer using the same groups consumer.
	 *
	 * The current group and position within the group is not preserved.
	 *
	 * @returns A new TrackConsumer instance
	 */
	clone(): TrackConsumer {
		return new TrackConsumer(this.name, this.priority, this.#state);
	}

	/**
	 * Closes the consumer, disposing of any internal state.
	 */
	close() {
		if (!TrackConsumer.#finalizer.unregister(this)) return;

		this.#nextGroup.then((next) => next.group?.close()).catch(() => {});
		this.#currentGroup?.close();
		this.#currentGroup = undefined;

		this.#state.mutate((state) => {
			state.consumers--;
		});
	}
}
