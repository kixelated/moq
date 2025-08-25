import type { GroupConsumer, GroupProducer, TrackConsumer, TrackProducer } from "@kixelated/moq";

// Creates a track that write a frame on true, and closes the group on false.
export class BoolProducer {
	track: TrackProducer;
	#group?: GroupProducer;

	constructor(track: TrackProducer) {
		this.track = track;
	}

	write(value: boolean) {
		if (value) {
			if (this.#group) return; // noop
			this.#group = this.track.appendGroup();
			this.#group.writeFrame(new Uint8Array([1]));
		} else {
			if (!this.#group) return; // noop
			this.#group.close();
			this.#group = undefined;
		}
	}

	clone() {
		return new BoolProducer(this.track);
	}

	close() {
		this.track.close();
		this.#group?.close();
		this.#group = undefined;
	}
}

export class BoolConsumer {
	track: TrackConsumer;
	#group?: GroupConsumer;

	constructor(track: TrackConsumer) {
		this.track = track;
	}

	async next(): Promise<boolean | undefined> {
		for (;;) {
			if (!this.#group) {
				const group = await this.track.nextGroup();
				if (!group) return undefined;

				this.#group = group;
				return true;
			}

			const group = await Promise.race([
				this.track.nextGroup(),
				this.#group.closed(),
			])
			if (group) {
				this.#group = group;
				continue;
			}

			this.#group.close();
			this.#group = undefined;
			return false;
		}
	}

	close() {
		this.track.close();
		this.#group?.close();
		this.#group = undefined;
	}
}
