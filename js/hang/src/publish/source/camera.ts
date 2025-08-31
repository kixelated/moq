import { Effect, Signal } from "@kixelated/signals";
import type { VideoConstraints, VideoStreamTrack } from "../video";
import { Device, type DeviceProps } from "./device";

export interface CameraProps {
	enabled?: boolean | Signal<boolean>;
	device?: DeviceProps;
	constraints?: VideoConstraints | Signal<VideoConstraints | undefined>;
}

export class Camera {
	enabled: Signal<boolean>;
	device: Device<"video">;

	constraints: Signal<VideoConstraints | undefined>;

	stream = new Signal<VideoStreamTrack | undefined>(undefined);
	signals = new Effect();

	constructor(props?: CameraProps) {
		this.device = new Device("video", props?.device);
		this.enabled = Signal.from(props?.enabled ?? false);
		this.constraints = Signal.from(props?.constraints);

		this.signals.effect(this.#run.bind(this));
	}

	#run(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const device = effect.get(this.device.requested);
		const constraints = effect.get(this.constraints) ?? {};

		// Build final constraints with device selection
		const finalConstraints: MediaTrackConstraints = {
			...constraints,
			deviceId: device ? { exact: device } : undefined,
		};

		effect.spawn(async (cancel) => {
			const media = navigator.mediaDevices.getUserMedia({ video: finalConstraints }).catch(() => undefined);

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

			this.device.permission.set(true);

			const track = stream.getVideoTracks()[0] as VideoStreamTrack | undefined;
			if (!track) return;

			const settings = track.getSettings();

			effect.set(this.device.active, settings.deviceId);
			effect.set(this.stream, track, undefined);
		});
	}

	close() {
		this.signals.close();
		this.device.close();
	}
}
