import { Effect, type Getter, Signal } from "@kixelated/signals";
import type { AudioConstraints, AudioStreamTrack } from "../audio";
import { Device } from "./device";

export interface MicrophoneProps {
	enabled?: boolean;
	device?: MediaDeviceInfo;
	constraints?: AudioConstraints;
}

export class Microphone {
	enabled: Signal<boolean>;
	device = new Device("audio");
	constraints: Signal<AudioConstraints | undefined>;

	#stream = new Signal<AudioStreamTrack | undefined>(undefined);
	readonly stream: Getter<AudioStreamTrack | undefined> = this.#stream;

	#signals = new Effect();

	constructor(props?: MicrophoneProps) {
		this.enabled = new Signal(props?.enabled ?? false);
		this.constraints = new Signal(props?.constraints);

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

			const track = stream.getAudioTracks()[0] as AudioStreamTrack | undefined;
			if (!track) return;

			effect.cleanup(() => track.stop());
			effect.set(this.#stream, track, undefined);

			const settings = track.getSettings();

			// If we got the device we asked for, we're done.
			if (device === settings.deviceId) return;

			// Otherwise, we want to select what we consider the default device.

			if (device) {
				console.warn("couldn't get requested device, using default", device);
			}

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
