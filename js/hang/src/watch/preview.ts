import type * as Moq from "@kixelated/moq";
import { type Computed, Root, Signal } from "@kixelated/signals";
import { Container } from "..";
import type * as Catalog from "../catalog";
import type * as Preview from "../preview";

export interface PreviewProps {
	enabled?: boolean;
}

export class PreviewWatch {
	broadcast: Signal<Moq.BroadcastConsumer | undefined>;
	enabled: Signal<boolean>;

	catalog: Computed<Catalog.Track | undefined>;
	track: Computed<Container.FrameConsumer | undefined>;
	preview: Computed<Preview.Preview | undefined>;

	#signals = new Root();

	constructor(
		broadcast: Signal<Moq.BroadcastConsumer | undefined>,
		catalog: Signal<Catalog.Root | undefined>,
		props?: PreviewProps,
	) {
		this.broadcast = broadcast;
		this.enabled = new Signal(props?.enabled ?? false);

		this.catalog = this.#signals.unique((effect) => {
			if (!effect.get(this.enabled)) return undefined;
			const root = effect.get(catalog);
			return root?.tracks?.find((t) => t.name === "preview.json");
		});

		this.track = this.#signals.computed((effect) => {
			const catalog = effect.get(this.catalog);
			if (!catalog) return undefined;

			const broadcast = effect.get(this.broadcast);
			if (!broadcast) return undefined;

			const track = broadcast.subscribe(catalog.name, catalog.priority);
			const consumer = new Container.FrameConsumer(track);

			effect.cleanup(() => consumer.close());
			return consumer;
		});

		this.preview = this.#signals.computed((effect) => {
			const track = effect.get(this.track);
			if (!track) return undefined;

			const frame = track.frame.peek();
			if (!frame) return undefined;

			try {
				const decoder = new TextDecoder();
				const json = decoder.decode(frame.payload);
				const parsed = JSON.parse(json);
				return Preview.PreviewSchema.parse(parsed);
			} catch (error) {
				console.warn("Failed to parse preview JSON:", error);
				return undefined;
			}
		});
	}

	close() {
		this.#signals.close();
	}
}
