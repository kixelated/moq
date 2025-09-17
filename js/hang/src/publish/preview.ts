import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import type { Info } from "../preview";

export type PreviewProps = {
	enabled?: boolean | Signal<boolean>;
	info?: Info | Signal<Info | undefined>;
};

export class Preview {
	enabled: Signal<boolean>;
	info: Signal<Info | undefined>;

	constructor(props?: PreviewProps) {
		this.enabled = Signal.from(props?.enabled ?? false);
		this.info = Signal.from(props?.info);
	}

	serve(track: Moq.Track, effect: Effect): void {
		if (!effect.get(this.enabled)) return;

		const info = effect.get(this.info);
		if (!info) return;

		track.writeJson(info);
	}
}
