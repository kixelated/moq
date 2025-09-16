import type * as Moq from "@kixelated/moq";
import type { Path } from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import type { Connection } from "../connection";
import { Member } from "./member";

export type RoomProps = {
	name?: Path.Valid | Signal<Path.Valid | undefined>;
	enabled?: boolean | Signal<boolean>;
};

export class Room {
	connection: Connection;
	name: Signal<Path.Valid | undefined>;
	enabled: Signal<boolean>;

	#members = new Map<Path.Valid, Member>();

	#onMember?: (name: Path.Valid, member: Member | undefined) => void;
	#signals = new Effect();

	constructor(connection: Connection, props?: RoomProps) {
		this.connection = connection;
		this.name = Signal.from(props?.name);
		this.enabled = Signal.from(props?.enabled ?? false);

		this.#signals.effect(this.#init.bind(this));
	}

	onMember(callback?: (name: Path.Valid, member: Member | undefined) => void) {
		this.#onMember = callback;
		if (!callback) return;

		for (const [name, member] of this.#members) {
			callback(name, member);
		}
	}

	#init(effect: Effect) {
		if (!effect.get(this.enabled)) return;

		const conn = effect.get(this.connection.established);
		if (!conn) return;

		const name = effect.get(this.name);

		const announced = conn.announced(name);
		effect.cleanup(() => announced.close());

		effect.spawn(this.#runMembers.bind(this, conn, announced));
	}

	async #runMembers(connection: Moq.Connection, announced: Moq.AnnouncedConsumer) {
		try {
			for (;;) {
				const update = await announced.next();
				if (!update) break;

				this.#handleUpdate(connection, update);
			}
		} finally {
			this.close();
		}
	}

	#handleUpdate(connection: Moq.Connection, update: Moq.Announce) {
		if (update.active) {
			const broadcast = connection.consume(update.name);

			const member = new Member(broadcast, { enabled: true });
			member.signals.effect((effect) => {
				member.enabled.set(effect.get(this.enabled));
			});

			this.#members.set(update.name, member);

			this.#onMember?.(update.name, member);
		} else {
			const existing = this.#members.get(update.name);
			if (!existing) return;

			existing.close();
			this.#members.delete(update.name);

			this.#onMember?.(update.name, undefined);
		}
	}

	close() {
		this.#signals.close();

		for (const [name, member] of this.#members) {
			member.close();
			this.#onMember?.(name, undefined);
		}

		this.#members = new Map();
	}
}
