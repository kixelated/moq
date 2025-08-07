import type * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import * as Preview from "./info";

export type MemberProps = {
	enabled?: boolean;
};

export class Member {
	broadcast: Moq.BroadcastConsumer;
	enabled: Signal<boolean>;
	info: Signal<Preview.Info | undefined>;

	signals = new Effect();

	constructor(broadcast: Moq.BroadcastConsumer, props?: MemberProps) {
		this.broadcast = broadcast;
		this.enabled = new Signal(props?.enabled ?? false);
		this.info = new Signal<Preview.Info | undefined>(undefined);

		this.signals.effect((effect) => {
			if (!effect.get(this.enabled)) return;

			// Subscribe to the preview.json track directly
			const track = this.broadcast.subscribe("preview.json", 0);
			effect.cleanup(() => track.close());

			effect.spawn(async (cancel) => {
				try {
					for (;;) {
						const frame = await Promise.race([track.nextFrame(), cancel]);
						if (!frame) break;

						// An empty group wipes the preview.
						if (frame.data.byteLength === 0) {
							this.info.set(undefined);
							continue;
						}

						const decoder = new TextDecoder();
						const json = decoder.decode(frame.data);
						const parsed = JSON.parse(json);
						this.info.set(Preview.InfoSchema.parse(parsed));
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
