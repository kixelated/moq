import { Signal } from "@kixelated/signals";
import type * as Path from "./path.ts";

/**
 * The availability of a broadcast.
 *
 * @public
 */
export interface Announced {
	name: Path.Valid;
	active: boolean;
}

export class AnnouncedState {
	queue = new Signal<Announced[]>([]);
	closed = new Signal<boolean | Error>(false);
}

/**
 * Handles writing announcements to the announcement queue.
 *
 * @public
 */
export class AnnouncedQueue {
	state = new AnnouncedState();

	readonly closed: Promise<Error | undefined>;

	constructor() {
		this.closed = new Promise((resolve) => {
			const dispose = this.state.closed.subscribe((closed) => {
				if (!closed) return;
				resolve(closed instanceof Error ? closed : undefined);
				dispose();
			});
		});
	}

	/**
	 * Writes an announcement to the queue.
	 * @param announcement - The announcement to write
	 */
	write(announcement: Announced) {
		if (this.state.closed.peek()) throw new Error("announced is closed");
		this.state.queue.mutate((queue) => {
			queue.push(announcement);
		});
	}

	/**
	 * Closes the writer.
	 * @param abort - If provided, throw this exception instead of returning undefined.
	 */
	close(abort?: Error) {
		this.state.closed.set(abort ?? true);
		this.state.queue.mutate((queue) => {
			queue.length = 0;
		});
	}

	/**
	 * Returns the next announcement.
	 */
	async next(): Promise<Announced | undefined> {
		for (;;) {
			const announce = this.state.queue.peek().shift();
			if (announce) return announce;

			const closed = this.state.closed.peek();
			if (closed instanceof Error) throw closed;
			if (closed) return undefined;

			await Signal.race(this.state.queue, this.state.closed);
		}
	}
}
