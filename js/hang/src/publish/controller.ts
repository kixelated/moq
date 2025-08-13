import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";

export type ControllerProps = {
	enabled?: boolean
	name?: string
	message?: string
}

export class Controller {
	broadcast: Moq.BroadcastProducer;
	enabled: Signal<boolean>;
	name: Signal<string>;
	message: Signal<string> // Sending messages as strings at least for now

	// Setting track to "seconds" for compatibility reasons (data could be published using moq-clock)
	#track = new Moq.TrackProducer("seconds", 0);
	#signals = new Effect();

	constructor(broadcast: Moq.BroadcastProducer, props?: ControllerProps) {
		this.broadcast = broadcast;
		this.enabled = new Signal(props?.enabled ?? false);
		this.name = new Signal(props?.name ?? "");
		this.message = new Signal(props?.message ?? "");

		this.#signals.effect((effect) => {
			const enabled = effect.get(this.enabled);
			if (!enabled) return;

			broadcast.insertTrack(this.#track.consume());
			effect.cleanup(() => broadcast.removeTrack(this.#track.name));

		});

		this.#signals.effect((effect) => {
			const message = effect.get(this.message);
			const group = this.#track.appendGroup();
			group.writeFrame(new TextEncoder().encode(message));
			group.close();
		});
	}

	close() {
		this.#signals.close();
	}
}
