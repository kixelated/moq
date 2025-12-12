import * as Hang from "@moq/hang";
import type * as Moq from "@moq/lite";
import * as Zod from "@moq/lite/zod";
import { Effect, Signal } from "@moq/signals";

export type MemberProps = {
	enabled?: boolean | Signal<boolean>;
};

export class Member {
	broadcast: Moq.Broadcast;
	enabled: Signal<boolean>;
	info: Signal<Hang.Catalog.Preview | undefined>;

	active = new Signal<boolean>(false);

	signals = new Effect();

	constructor(broadcast: Moq.Broadcast, props?: MemberProps) {
		this.broadcast = broadcast;
		this.enabled = Signal.from(props?.enabled ?? false);
		this.info = new Signal<Hang.Catalog.Preview | undefined>(undefined);

		this.signals.effect((effect) => {
			if (!effect.get(this.enabled)) return;

			// Subscribe to the preview.json track directly
			const track = this.broadcast.subscribe("preview.json", 0);
			effect.cleanup(() => track.close());

			effect.spawn(async () => {
				try {
					for (;;) {
						const frame = await Zod.read(track, Hang.Catalog.PreviewSchema);
						if (!frame) break;

						this.info.set(frame);
					}
				} finally {
					this.info.set(undefined);
				}
			});
		});

		this.signals.effect((effect) => {
			const info = effect.get(this.info);
			this.active.set(!!info);
		});
	}

	close() {
		this.signals.close();
		this.broadcast.close();
	}
}
