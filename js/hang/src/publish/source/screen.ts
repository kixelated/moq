import { Effect, Signal } from "@kixelated/signals";
import type { AudioConstraints, AudioStreamTrack } from "../audio";
import type { VideoConstraints, VideoStreamTrack } from "../video";

export interface ScreenProps {
	enabled?: boolean | Signal<boolean>;
	video?: VideoConstraints | boolean | Signal<VideoConstraints | boolean | undefined>;
	audio?: AudioConstraints | boolean | Signal<AudioConstraints | boolean | undefined>;
}

export class Screen {
	enabled: Signal<boolean>;

	video: Signal<VideoConstraints | boolean | undefined>;
	audio: Signal<AudioConstraints | boolean | undefined>;

	stream = new Signal<{ audio?: AudioStreamTrack; video?: VideoStreamTrack } | undefined>(undefined);
	signals = new Effect();

	constructor(props?: ScreenProps) {
		this.enabled = Signal.from(props?.enabled ?? false);
		this.video = Signal.from(props?.video);
		this.audio = Signal.from(props?.audio);

		this.signals.effect(this.#run.bind(this));
	}

	#run(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const video = effect.get(this.video);
		const audio = effect.get(this.audio);

		// TODO Expose these to the application.
		// @ts-expect-error Chrome only
		let controller: CaptureController | undefined;
		// @ts-expect-error Chrome only
		if (typeof self.CaptureController !== "undefined") {
			// @ts-expect-error Chrome only
			controller = new CaptureController();
			controller.setFocusBehavior("no-focus-change");
		}

		effect.spawn(async (cancel) => {
			const media = await Promise.race([
				navigator.mediaDevices.getDisplayMedia({
					video,
					audio,
					// @ts-expect-error Chrome only
					controller,
					preferCurrentTab: false,
					selfBrowserSurface: "exclude",
					surfaceSwitching: "include",
					// TODO We should try to get system audio, but need to be careful about feedback.
					// systemAudio: "exclude",
				}),
				cancel,
			]);

			if (!media) return;

			const v = media.getVideoTracks().at(0) as VideoStreamTrack | undefined;
			const a = media.getAudioTracks().at(0) as AudioStreamTrack | undefined;

			effect.cleanup(() => v?.stop());
			effect.cleanup(() => a?.stop());
			effect.set(this.stream, { video: v, audio: a }, undefined);
		});
	}

	close() {
		this.signals.close();
	}
}
