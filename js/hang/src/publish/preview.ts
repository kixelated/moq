import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import * as Catalog from "../catalog";

export type PreviewProps = {
	enabled?: boolean | Signal<boolean>;
	info?: Catalog.Preview | Signal<Catalog.Preview | undefined>;
};

export class Preview {
	static readonly TRACK = "preview.json";

	enabled: Signal<boolean>;
	info: Signal<Catalog.Preview | undefined>;

	catalog = new Signal<Catalog.Track | undefined>(undefined);

	signals = new Effect();

	constructor(props?: PreviewProps) {
		this.enabled = Signal.from(props?.enabled ?? false);
		this.info = Signal.from(props?.info);

		this.signals.effect((effect) => {
			if (!effect.get(this.enabled)) return;
			effect.set(this.catalog, Preview.TRACK);
		});
	}

	serve(track: Moq.Track, effect: Effect): void {
		if (!effect.get(this.enabled)) return;

		const info = effect.get(this.info);
		if (!info) return;

		track.writeJson(info);
	}

	close() {
		this.signals.close();
	}
}
