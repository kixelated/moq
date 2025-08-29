import { Effect, Signal } from "@kixelated/signals";
import type { AudioConstraints, AudioStreamTrack } from "../audio";
import { Device, type DeviceProps } from "./device";

export interface MicrophoneProps {
	enabled?: boolean | Signal<boolean>;
	device?: DeviceProps;
	constraints?: AudioConstraints | Signal<AudioConstraints | undefined>;
}

export class Microphone {
	enabled: Signal<boolean>;

	device: Device<"audio">;

	constraints: Signal<AudioConstraints | undefined>;
	stream = new Signal<AudioStreamTrack | undefined>(undefined);

	signals = new Effect();

	constructor(props?: MicrophoneProps) {
		this.device = new Device("audio", props?.device);

		this.enabled = Signal.from(props?.enabled ?? false);
		this.constraints = Signal.from(props?.constraints);

		this.signals.effect(this.#run.bind(this));
	}

	#run(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const device = effect.get(this.device.selected);
		if (!device) return;

		const constraints = effect.get(this.constraints) ?? {};
		const finalConstraints: MediaTrackConstraints = {
			...constraints,
			deviceId: { exact: device.deviceId },
		};

		effect.spawn(async (cancel) => {
			const media = navigator.mediaDevices.getUserMedia({ audio: finalConstraints }).catch(() => undefined);

			// If the effect is cancelled for any reason (ex. cancel), stop any media that we got.
			effect.cleanup(() =>
				media.then((media) =>
					media?.getTracks().forEach((track) => {
						track.stop();
					}),
				),
			);

			const stream = await Promise.race([media, cancel]);
			if (!stream) return;

			const track = stream.getAudioTracks()[0] as AudioStreamTrack | undefined;
			if (!track) return;

			effect.set(this.stream, track, undefined);
		});
	}

	close() {
		this.signals.close();
		this.device.close();
	}
}
