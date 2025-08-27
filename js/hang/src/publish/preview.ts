import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
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
	#signals = new Effect();

	constructor(broadcast: Moq.BroadcastProducer, props?: PreviewProps) {
		this.broadcast = broadcast;
		this.enabled = new Signal(props?.enabled ?? false);
		this.info = new Signal(props?.info);

		this.#signals.effect((effect) => {
			const enabled = effect.get(this.enabled);
			if (!enabled) return;

			broadcast.insertTrack(this.#track.consume());
			effect.cleanup(() => broadcast.removeTrack(this.#track.name));
		});

		this.#signals.effect((effect) => {
			if (!effect.get(this.enabled)) return;

			const info = effect.get(this.info);
			if (!info) return;

			this.#publish(info);
		});
	}

	#publish(preview: Info) {
		this.#track.writeJson(preview);
	}

	close() {
		this.#signals.close();
	}
}
