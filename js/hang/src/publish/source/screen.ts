import { Effect, type Getter, Signal } from "@kixelated/signals";
import type { AudioConstraints, AudioStreamTrack } from "../audio";
import type { VideoConstraints, VideoStreamTrack } from "../video";

export interface ScreenProps {
	enabled?: boolean;
	constraints?: {
		video?: VideoConstraints;
		audio?: AudioConstraints;
	};
}

export class Screen {
	enabled: Signal<boolean>;

	constraints: Signal<{ video?: VideoConstraints; audio?: AudioConstraints } | undefined>;

	#stream = new Signal<{ audio?: AudioStreamTrack; video?: VideoStreamTrack } | undefined>(undefined);
	readonly stream: Getter<{ audio?: AudioStreamTrack; video?: VideoStreamTrack } | undefined> = this.#stream;

	#signals = new Effect();

	constructor(props?: ScreenProps) {
		this.enabled = new Signal(props?.enabled ?? false);
		this.constraints = new Signal(props?.constraints);

		this.#signals.effect(this.#run.bind(this));
	}

	#run(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const constraints = effect.get(this.constraints) ?? {};

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
			const media = await Promise.race([navigator.mediaDevices.getDisplayMedia({
				video: constraints.video ?? true,
				audio: constraints.audio ?? true,
				// @ts-expect-error Chrome only
				controller,
				preferCurrentTab: false,
				selfBrowserSurface: "exclude",
				surfaceSwitching: "include",
				// TODO We should try to get system audio, but need to be careful about feedback.
				// systemAudio: "exclude",
			}), cancel]);

			if (!media) return;

			const v = media.getVideoTracks().at(0) as VideoStreamTrack | undefined;
			const a = media.getAudioTracks().at(0) as AudioStreamTrack | undefined;

			effect.cleanup(() => v?.stop());
			effect.cleanup(() => a?.stop());
			effect.set(this.#stream, { video: v, audio: a }, undefined);
		});
	}

	close() {
		this.#signals.close();
	}
}
