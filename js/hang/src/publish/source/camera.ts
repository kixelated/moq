import { Effect, Signal } from "@kixelated/signals";
import type { VideoConstraints, VideoStreamTrack } from "../video";
import { Device, type DeviceProps } from "./device";

export interface CameraProps {
	enabled?: boolean | Signal<boolean>;
	device?: DeviceProps;
	constraints?: VideoConstraints | Signal<VideoConstraints | undefined>;
	flip?: boolean;
}

export class Camera {
	enabled: Signal<boolean>;
	device: Device<"video">;

	constraints: Signal<VideoConstraints | undefined>;
	flip: Signal<boolean>;

	stream = new Signal<VideoStreamTrack | undefined>(undefined);
	signals = new Effect();

	constructor(props?: CameraProps) {
		this.device = new Device("video", props?.device);
		this.enabled = Signal.from(props?.enabled ?? false);
		this.constraints = Signal.from(props?.constraints);
		this.flip = Signal.from(props?.flip ?? false);

		this.signals.effect(this.#run.bind(this));
	}

	#run(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const device = effect.get(this.device.selected);
		if (!device) return;

		console.log("requesting camera", device);

		const constraints = effect.get(this.constraints) ?? {};

		// Build final constraints with device selection
		const finalConstraints: MediaTrackConstraints = {
			deviceId: { exact: device.deviceId },
			...constraints,
		};

		effect.spawn(async (cancel) => {
			const stream = await Promise.race([
				navigator.mediaDevices.getUserMedia({ video: finalConstraints }).catch(() => undefined),
				cancel,
			]);
			if (!stream) return;

			const track = stream.getVideoTracks()[0] as VideoStreamTrack | undefined;
			if (!track) return;

			effect.cleanup(() => track.stop());
			effect.set(this.stream, track, undefined);
		});
	}

	close() {
		this.signals.close();
		this.device.close();
	}
}
