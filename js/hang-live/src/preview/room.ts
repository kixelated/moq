import type * as Moq from "@moq/lite";
import { Path } from "@moq/lite";
import { Effect, Getter, Signal } from "@moq/signals";
import { Member } from "./member";

export interface RoomProps {
	connection: Moq.Connection.Established | Signal<Moq.Connection.Established | undefined>;
	path?: Path.Valid | Signal<Path.Valid | undefined>;
	enabled?: boolean | Signal<boolean>;
}

export class Room {
	connection: Signal<Moq.Connection.Established | undefined>;
	path: Signal<Path.Valid | undefined>;
	enabled: Signal<boolean>;

	#members = new Signal(new Map<Path.Valid, Member>());
	#signals = new Effect();

	constructor(props?: RoomProps) {
		this.connection = Signal.from(props?.connection);
		this.path = Signal.from(props?.path);
		this.enabled = Signal.from(props?.enabled ?? false);

		this.#signals.effect(this.#init.bind(this));
	}

	#init(effect: Effect) {
		if (!effect.get(this.enabled)) return;

		const conn = effect.get(this.connection);
		if (!conn) return;

		const path = effect.get(this.path);

		const announced = conn.announced(path);
		effect.cleanup(() => announced.close());

		effect.spawn(async () => {
			for (;;) {
				const update = await announced.next();
				if (!update) break;

				if (!update.active) {
					// Close the member when they're not active.
					this.#members.mutate((members) => members.get(update.path)?.close());
					continue;
				}

				const broadcast = conn.consume(update.path);

				const member = new Member(broadcast, { enabled: this.enabled });
				effect.cleanup(() => member.close());

				// Only add the member when they're publishing preview info.
				member.signals.effect((effect) => {
					const active = effect.get(member.active);
					if (!active) return;

					this.#members.mutate((members) => members.set(update.path, member));
					effect.cleanup(() => {
						this.#members.mutate((members) => members.delete(update.path));
					});
				});
			}
		});
	}

	get members(): Getter<Map<Path.Valid, Member>> {
		return this.#members;
	}

	close() {
		this.#signals.close();
	}
}
