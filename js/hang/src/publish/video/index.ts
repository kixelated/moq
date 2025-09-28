import { Effect, Signal } from "@kixelated/signals";
import * as Catalog from "../../catalog";
import { Detection, DetectionProps } from "./detection";
import { Encoder, EncoderProps } from "./encoder";
import { TrackProcessor } from "./polyfill";
import { Source } from "./types";

export * from "./detection";
export * from "./encoder";
export * from "./types";

export type Props = {
	source?: Source | Signal<Source | undefined>;
	detection?: DetectionProps;
	hd?: EncoderProps;
	sd?: EncoderProps;
};

export class Root {
	static readonly TRACK_HD: Catalog.Track = "video/hd";
	static readonly TRACK_SD: Catalog.Track = "video/sd";

	source: Signal<Source | undefined>;
	detection: Detection;
	hd: Encoder;
	sd: Encoder;

	frame = new Signal<VideoFrame | undefined>(undefined);

	catalog = new Signal<Catalog.Video | undefined>(undefined);
	signals = new Effect();

	constructor(props?: Props) {
		this.source = Signal.from(props?.source);

		this.detection = new Detection(this.frame, props?.detection);
		this.hd = new Encoder(this.frame, this.source, props?.hd);
		this.sd = new Encoder(this.frame, this.source, props?.sd);

		this.signals.effect(this.#runCatalog.bind(this));
		this.signals.effect(this.#runFrame.bind(this));
	}

	#runFrame(effect: Effect) {
		const source = effect.get(this.source);
		if (!source) return;

		const reader = TrackProcessor(source).getReader();
		effect.cleanup(() => reader.cancel());

		effect.spawn(async () => {
			for (;;) {
				const next = await Promise.race([reader.read(), effect.cancel]);
				if (!next || !next.value) break;

				this.frame.update((prev) => {
					prev?.close();
					return next.value;
				});
			}
		});

		effect.cleanup(() => {
			this.frame.update((prev) => {
				prev?.close();
				return undefined;
			});
		});
	}

	#runCatalog(effect: Effect) {
		const source = effect.get(this.source);
		if (!source) return;

		const hdConfig = effect.get(this.hd.catalog);
		const sdConfig = effect.get(this.sd.catalog);

		const renditions: Catalog.VideoRendition[] = [];
		if (hdConfig) renditions.push({ track: Root.TRACK_HD, config: hdConfig });
		if (sdConfig) renditions.push({ track: Root.TRACK_SD, config: sdConfig });

		const catalog: Catalog.Video = {
			renditions,
			detection: effect.get(this.detection.catalog),
		};
		effect.set(this.catalog, catalog);
	}

	close() {
		this.signals.close();
		this.detection.close();
		this.hd.close();
		this.sd.close();
	}
}
