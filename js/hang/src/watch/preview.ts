import type * as Moq from "@kixelated/moq";
import { Root, Signal, Unique } from "@kixelated/signals";
import { Container } from "..";
import type * as Catalog from "../catalog";
import * as Preview from "../preview";

export interface PreviewProps {
	enabled?: boolean;
}

export class PreviewWatch {
	broadcast: Signal<Moq.BroadcastConsumer | undefined>;
	enabled: Signal<boolean>;

	track = new Unique<Container.FrameConsumer | undefined>(undefined);
	preview = new Unique<Preview.Info | undefined>(undefined);

	#signals = new Root();

	constructor(
		broadcast: Signal<Moq.BroadcastConsumer | undefined>,
		_catalog: Signal<Catalog.Root | undefined>,
		props?: PreviewProps,
	) {
		this.broadcast = broadcast;
		this.enabled = new Signal(props?.enabled ?? false);

		this.#signals.effect((effect) => {
			if (!effect.get(this.enabled)) {
				this.track.set(undefined);
				return;
			}

			const broadcast = effect.get(this.broadcast);
			if (!broadcast) {
				this.track.set(undefined);
				return;
			}

			// Subscribe to the preview.json track directly
			const track = broadcast.subscribe("preview.json", 0);
			const consumer = new Container.FrameConsumer(track);

			effect.cleanup(() => track.close());
			this.track.set(consumer);
		});

		this.#signals.effect((effect) => {
			const track = effect.get(this.track);
			if (!track) {
				this.preview.set(undefined);
				return;
			}

			effect.spawn(async () => {
				try {
					const frame = await track.decode();
					if (!frame) return;

					const decoder = new TextDecoder();
					const json = decoder.decode(frame.data);
					const parsed = JSON.parse(json);
					this.preview.set(Preview.PreviewSchema.parse(parsed));
				} catch (error) {
					console.warn("Failed to parse preview JSON:", error);
				}
			});
		});
	}

	close() {
		this.#signals.close();
	}
}
