import { type WatchConsumer, WatchProducer } from "./util/watch";

/**
 * Handles writing frames to a group.
 *
 * @public
 */
export class GroupProducer {
	/** The unique identifier for this writer */
	readonly id: number;

	// A stream of frames.
	#frames = new WatchProducer<Uint8Array[]>([]);

	/**
	 * Creates a new GroupProducer with the specified ID and frames producer.
	 * @param id - The unique identifier
	 *
	 * @internal
	 */
	constructor(id: number) {
		this.id = id;
	}

	/**
	 * Writes a frame to the group.
	 * @param frame - The frame to write
	 */
	writeFrame(frame: Uint8Array) {
		this.#frames.update((frames) => [...frames, frame]);
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
	 */
	close() {
		this.#frames.close();
	}

	/**
	 * Returns a promise that resolves when the writer is unused.
	 * @returns A promise that resolves when unused
	 */
	async unused(): Promise<void> {
		await this.#frames.unused();
	}

	/**
	 * Aborts the writer with an error.
	 * @param reason - The error reason for aborting
	 */
	abort(reason: Error) {
		this.#frames.abort(reason);
	}

	consume(): GroupConsumer {
		return new GroupConsumer(this.#frames.consume(), this.id);
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

	#frames: WatchConsumer<Uint8Array[]>;
	#index = 0;

	/**
	 * Creates a new GroupConsumer with the specified ID and frames consumer.
	 * @param id - The unique identifier
	 * @param frames - The frames consumer
	 *
	 * @internal
	 */
	constructor(frames: WatchConsumer<Uint8Array[]>, id: number) {
		this.sequence = id;
		this.#frames = frames;
	}

	/**
	 * Reads the next frame from the group.
	 * @returns A promise that resolves to the next frame or undefined
	 */
	async readFrame(): Promise<Uint8Array | undefined> {
		const frames = await this.#frames.when((frames) => frames.length > this.#index);
		return frames?.at(this.#index++);
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
	 * Returns a promise that resolves when the reader is closed.
	 * @returns A promise that resolves when closed
	 */
	async closed(): Promise<void> {
		await this.#frames.closed();
	}

	/**
	 * Closes the reader.
	 */
	close() {
		this.#frames.close();
	}

	/**
	 * Creates a new instance of the reader using the same frames consumer.
	 * @returns A new GroupConsumer instance
	 */
	clone(): GroupConsumer {
		return new GroupConsumer(this.#frames.clone(), this.sequence);
	}

	get index() {
		return this.#index;
	}
}
