import type * as Moq from "@kixelated/moq";
import * as Zod from "@kixelated/moq/zod";
import { Effect, Signal } from "@kixelated/signals";
import * as Preview from "./info";

export type MemberProps = {
	enabled?: boolean | Signal<boolean>;
};

export class Member {
	broadcast: Moq.BroadcastConsumer;
	enabled: Signal<boolean>;
	info: Signal<Preview.Info | undefined>;

	signals = new Effect();

	constructor(broadcast: Moq.BroadcastConsumer, props?: MemberProps) {
		this.broadcast = broadcast;
		this.enabled = Signal.from(props?.enabled ?? false);
		this.info = new Signal<Preview.Info | undefined>(undefined);

		this.signals.effect((effect) => {
			if (!effect.get(this.enabled)) return;

			// Subscribe to the preview.json track directly
			const track = this.broadcast.subscribe("preview.json", 0);
			effect.cleanup(() => track.close());

			effect.spawn(async () => {
				try {
					for (;;) {
						const frame = await Zod.read(track, Preview.InfoSchema);
						if (!frame) break;

						this.info.set(frame);
					}
				} finally {
					this.info.set(undefined);
				}
			});
		});
	}

	close() {
		this.signals.close();
		this.broadcast.close();
	}
}
