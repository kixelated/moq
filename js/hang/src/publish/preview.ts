import * as Moq from "@kixelated/moq";
import { type Computed, type Effect, Root, Signal } from "@kixelated/signals";
import type * as Catalog from "../catalog";
import type * as Preview from "../preview";

export type PreviewProps = {
	enabled?: boolean;
};

export class PreviewPublish {
	broadcast: Moq.BroadcastProducer;
	enabled: Signal<boolean>;

	displayName: Signal<string>;
	avatar: Signal<string | undefined>;
	audio: Signal<boolean>;
	video: Signal<boolean>;

	catalog: Computed<Catalog.Track | undefined>;

	#track = new Moq.TrackProducer("preview.json", 0);
	#group?: Moq.GroupProducer;

	#signals = new Root();

	constructor(broadcast: Moq.BroadcastProducer, props?: PreviewProps) {
		this.broadcast = broadcast;
		this.enabled = new Signal(props?.enabled ?? false);

		this.displayName = new Signal("");
		this.avatar = new Signal<string | undefined>(undefined);
		this.audio = new Signal(false);
		this.video = new Signal(false);

		this.catalog = this.#signals.computed<Catalog.Track | undefined>((effect: Effect) => {
			const enabled = effect.get(this.enabled);
			if (!enabled) return;

			broadcast.insertTrack(this.#track.consume());
			effect.cleanup(() => broadcast.removeTrack(this.#track.name));

			return { name: this.#track.name, priority: this.#track.priority };
		});

		this.#signals.effect((effect) => {
			if (!effect.get(this.enabled)) return;

			const preview: Preview.Preview = {
				displayName: effect.get(this.displayName),
				avatar: effect.get(this.avatar),
				audio: effect.get(this.audio),
				video: effect.get(this.video),
			};

			this.#publish(preview);
		});
	}

	#publish(preview: Preview.Preview) {
		const encoder = new TextEncoder();
		const json = JSON.stringify(preview);
		const buffer = encoder.encode(json);

		this.#group?.close();
		this.#group = this.#track.appendGroup();
		this.#group.writeFrame(buffer);
	}

	close() {
		this.#group?.close();
		this.#signals.close();
	}
}
