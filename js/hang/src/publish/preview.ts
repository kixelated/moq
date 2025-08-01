import * as Moq from "@kixelated/moq";
import { Root, Signal } from "@kixelated/signals";
import type { Info } from "../preview";

export type PreviewProps = {
	enabled?: boolean;
	info?: Info;
};

export class Preview {
	broadcast: Moq.BroadcastProducer;
	enabled: Signal<boolean>;
	info: Signal<Info | undefined>;

	#track = new Moq.TrackProducer("preview.json", 0);

	#signals = new Root();

	constructor(broadcast: Moq.BroadcastProducer, props?: PreviewProps) {
		this.broadcast = broadcast;
		this.enabled = new Signal(props?.enabled ?? false);
		this.info = new Signal(props?.info);

		// Create an empty group to start with.
		this.#track.appendGroup().close();

		this.#signals.effect((effect) => {
			const enabled = effect.get(this.enabled);
			if (!enabled) return;

			broadcast.insertTrack(this.#track.consume());
			effect.cleanup(() => broadcast.removeTrack(this.#track.name));
		});

		this.#signals.effect((effect) => {
			if (!effect.get(this.enabled)) return;

			const info = effect.get(this.info);
			this.#publish(info);
		});
	}

	#publish(preview?: Info) {
		const encoder = new TextEncoder();
		const group = this.#track.appendGroup();

		// Write an empty group if there is no info.
		// TODO or empty frame?
		if (preview) {
			const json = JSON.stringify(preview);
			const buffer = encoder.encode(json);
			group.writeFrame(buffer);
		}

		group.close();
	}

	close() {
		this.#signals.close();
	}
}
