import { Effect, type Getter, Signal } from "@kixelated/signals";
import type { VideoConstraints, VideoStreamTrack } from "../video";
import { Device } from "./device";

export interface CameraProps {
	enabled?: boolean;
	device?: string;
	constraints?: VideoConstraints;
	flip?: boolean;
}

export class Camera {
	enabled: Signal<boolean>;

	device = new Device("video");
	constraints: Signal<VideoConstraints | undefined>;
	flip: Signal<boolean>;

	#stream = new Signal<VideoStreamTrack | undefined>(undefined);
	readonly stream: Getter<VideoStreamTrack | undefined> = this.#stream;

	#signals = new Effect();

	constructor(props?: CameraProps) {
		this.enabled = new Signal(props?.enabled ?? false);
		this.constraints = new Signal(props?.constraints);
		this.flip = new Signal(props?.flip ?? false);

		this.#signals.effect(this.#run.bind(this));
	}

	#run(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const device = effect.get(this.device.selected);
		const constraints = effect.get(this.constraints) ?? {};

		// Build final constraints with device selection
		const finalConstraints: MediaTrackConstraints = {
			deviceId: device ? { ideal: device } : undefined,
			...constraints,
		};

		effect.spawn(async (cancel) => {
			const stream = await Promise.race([
				navigator.mediaDevices.getUserMedia({ video: finalConstraints }),
				cancel,
			]);
			if (!stream) return;

			const track = stream.getVideoTracks()[0] as VideoStreamTrack | undefined;
			if (!track) return;

			effect.cleanup(() => track.stop());
			effect.set(this.#stream, track, undefined);

			const settings = track.getSettings();

			// If we got the device we asked for, we're done.
			if (device === settings.deviceId) return;

			if (device) {
				console.warn("couldn't get requested device, using default", device);
			}

			// Otherwise, we want to select what we consider the default device.

			effect.effect((nested) => {
				const available = nested.get(this.device.available);
				if (!available) return;

				// Explicitly select the default device if we found one.
				// Otherwise use the device the browser selected (might be the same).
				// NOTE: This will cause getUserMedia to be called again, but it's fine?
				const defaultDevice = nested.get(this.device.default);
				if (defaultDevice && defaultDevice.deviceId !== settings.deviceId) {
					console.debug("overriding default device", defaultDevice.label);
				}

				this.device.selected.set(defaultDevice?.deviceId ?? settings.deviceId);
			});
		});
	}

	close() {
		this.#signals.close();
		this.device.close();
	}
}
