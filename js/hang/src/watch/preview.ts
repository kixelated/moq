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
			if (!effect.get(this.enabled)) return undefined;

			const broadcast = effect.get(this.broadcast);
			if (!broadcast) return undefined;

			// Subscribe to the preview.json track directly
			const track = broadcast.subscribe("preview.json", 0);
			const consumer = new Container.FrameConsumer(track);

			effect.cleanup(() => track.close());
			return consumer;
		});

		this.#signals.effect((effect) => {
			const track = effect.get(this.track);
			if (!track) return undefined;

			// Create an async effect to fetch and parse the preview
			const preview = new Signal<Preview.Info | undefined>(undefined);

			effect.spawn(async () => {
				try {
					const frame = await track.decode();
					if (!frame) return;

					const decoder = new TextDecoder();
					const json = decoder.decode(frame.data);
					const parsed = JSON.parse(json);
					preview.set(Preview.PreviewSchema.parse(parsed));
				} catch (error) {
					console.warn("Failed to parse preview JSON:", error);
				}
			});

			return effect.get(preview);
		});
	}

	close() {
		this.#signals.close();
	}
}
