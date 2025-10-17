import { Effect, Signal } from "@kixelated/signals";
import * as Catalog from "../../catalog";
import { PRIORITY } from "../priority";
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
	flip?: boolean | Signal<boolean>;
};

export class Root {
	static readonly TRACK_HD = "video/hd";
	static readonly TRACK_SD = "video/sd";
	static readonly PRIORITY = PRIORITY.video;

	source: Signal<Source | undefined>;
	detection: Detection;
	hd: Encoder;
	sd: Encoder;

	frame = new Signal<VideoFrame | undefined>(undefined);

	catalog = new Signal<Catalog.Video | undefined>(undefined);
	display = new Signal<{ width: number; height: number } | undefined>(undefined);
	flip = new Signal<boolean>(false);

	signals = new Effect();

	constructor(props?: Props) {
		this.source = Signal.from(props?.source);

		this.hd = new Encoder(this.frame, this.source, props?.hd);
		this.sd = new Encoder(this.frame, this.source, props?.sd);
		this.detection = new Detection(this.frame, props?.detection);

		this.flip = Signal.from(props?.flip ?? false);

		this.signals.effect(this.#runCatalog.bind(this));
		this.signals.effect(this.#runFrame.bind(this));
	}

	#runFrame(effect: Effect) {
		const source = effect.get(this.source);
		if (!source) return;

		// NOTE: We modify the stock MediaStreamTrackProcessor so timestamps use our wall clock time.
		// This is so even when the source is changed or encoder reloaded, the timestamps will be consistent.
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

				this.display.set({ width: next.value.codedWidth, height: next.value.codedHeight });
			}
		});

		effect.cleanup(() => {
			this.frame.update((prev) => {
				prev?.close();
				return undefined;
			});
			this.display.set(undefined);
		});
	}

	#runCatalog(effect: Effect) {
		const source = effect.get(this.source);
		if (!source) return;

		const display = effect.get(this.display);
		if (!display) return;

		const hdConfig = effect.get(this.hd.catalog);
		const sdConfig = effect.get(this.sd.catalog);

		const renditions: Record<string, Catalog.VideoConfig> = {};
		if (hdConfig) renditions[Root.TRACK_HD] = hdConfig;
		if (sdConfig) renditions[Root.TRACK_SD] = sdConfig;

		const catalog: Catalog.Video = {
			renditions,
			priority: Root.PRIORITY,
			display: {
				width: Catalog.u53(display.width),
				height: Catalog.u53(display.height),
			},
			detection: effect.get(this.detection.catalog),
			flip: effect.get(this.flip) ?? undefined,
		};

		effect.set(this.catalog, catalog);
	}

	close() {
		this.signals.close();
		this.hd.close();
		this.sd.close();
		this.detection.close();

		this.frame.update((prev) => {
			prev?.close();
			return undefined;
		});
	}
}
