import { Effect, Signal } from "@kixelated/signals";

export class GroupState {
	frames: Signal<Uint8Array[]>;
	closed: Signal<boolean | Error>;
	consumers: Signal<number>;

	constructor() {
		this.frames = new Signal<Uint8Array[]>([]);
		this.closed = new Signal<boolean | Error>(false);
		this.consumers = new Signal(0);
	}
}

/**
 * Handles writing frames to a group.
 *
 * @public
 */
export class GroupProducer {
	/** The unique identifier for this writer */
	readonly sequence: number;

	state: GroupState;

	static #finalizer = new FinalizationRegistry(() => {
		console.warn("GroupProducer was garbage collected without being closed");
	});

	signals = new Effect();

	/**
	 * Creates a new GroupProducer with the specified ID and frames producer.
	 * @param sequence - The incrementing sequence number
	 *
	 * @internal
	 */
	constructor(sequence: number) {
		this.sequence = sequence;
		this.state = new GroupState();
		GroupProducer.#finalizer.register(this, sequence, this);
	}

	/**
	 * Writes a frame to the group.
	 * @param frame - The frame to write
	 */
	writeFrame(frame: Uint8Array) {
		if (this.state.closed.peek()) throw new Error("group is closed");
		this.state.frames.mutate((frames) => {
			frames.push(frame);
		});
	}

	writeString(str: string) {
		this.writeFrame(new TextEncoder().encode(str));
	}

	writeJson(json: unknown) {
		this.writeString(JSON.stringify(json));
	}

	writeBool(bool: boolean) {
		this.writeFrame(new Uint8Array([bool ? 1 : 0]));
	}

	/**
	 * Closes the writer.
	 * @param abort - If provided, throw this exception.
	 */
	close(abort?: Error) {
		if (!GroupProducer.#finalizer.unregister(this)) return;
		this.state.closed.set(abort ?? true);
		this.signals.close();
	}

	consume(): GroupConsumer {
		return new GroupConsumer(this.sequence, this.state);
	}
}

/**
 * Handles reading frames from a group.
 *
 * @public
 */
export class GroupConsumer {
	/** The unique identifier for this reader */
	readonly sequence: number;

	state: GroupState;

	#index = 0;

	//#close!: (error: Error | undefined) => void;
	closed = new Signal<Error | boolean>(false);

	static #finalizer = new FinalizationRegistry(() => {
		console.warn("GroupConsumer was garbage collected without being closed");
	});

	signals = new Effect();

	/**
	 * Creates a new GroupConsumer with the specified ID and frames consumer.
	 * @param id - The unique identifier
	 * @param frames - The frames consumer
	 *
	 * @internal
	 */
	constructor(sequence: number, state: GroupState) {
		this.sequence = sequence;
		this.state = state;
		this.state.consumers.update((consumers) => consumers + 1);

		this.signals.effect((effect) => {
			const closed = effect.get(this.state.closed);
			if (!closed) return;
			this.closed.set(closed);
		});
	}

	/**
	 * Reads the next frame from the group.
	 * @returns A promise that resolves to the next frame or undefined
	 */
	async readFrame(): Promise<Uint8Array | undefined> {
		const state = await this.state.frames.until((frames) => frames.length > this.#index);
		if (frames.length > this.#index) {
			return frames.at(this.#index++);
		}
		if (state.closed instanceof Error) throw state.closed;
		return;
	}

	async readString(): Promise<string | undefined> {
		const frame = await this.readFrame();
		return frame ? new TextDecoder().decode(frame) : undefined;
	}

	async readJson(): Promise<unknown | undefined> {
		const frame = await this.readString();
		return frame ? JSON.parse(frame) : undefined;
	}

	async readBool(): Promise<boolean | undefined> {
		const frame = await this.readFrame();
		return frame ? frame[0] === 1 : undefined;
	}

	/**
	 * Closes the reader.
	 */
	close(reason?: Error) {
		if (!GroupConsumer.#finalizer.unregister(this)) return;
		this.#state.mutate((state) => {
			state.consumers--;
		});
		this.closed.set(reason);
		this.#signals.close();
	}

	/**
	 * Creates a new instance of the reader using the same frames consumer.
	 * @returns A new GroupConsumer instance
	 */
	clone(): GroupConsumer {
		return new GroupConsumer(this.sequence, this.#state);
	}

	get index() {
		return this.#index;
	}
}
