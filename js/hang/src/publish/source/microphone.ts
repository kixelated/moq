import { Effect, type Getter, Signal } from "@kixelated/signals";
import type { AudioConstraints, AudioStreamTrack } from "../audio";

export interface MicrophoneProps {
	enabled?: boolean | Signal<boolean>;
	device?: string | Signal<string | undefined>;
	constraints?: AudioConstraints | Signal<AudioConstraints | undefined>;
}

export class Microphone {
	enabled: Signal<boolean>;
	device: Signal<string | undefined>;

	#devices = new Signal<MediaDeviceInfo[] | undefined>(undefined);
	readonly devices: Getter<MediaDeviceInfo[] | undefined> = this.#devices;

	#default = new Signal<MediaDeviceInfo | undefined>(undefined);

	constraints: Signal<AudioConstraints | undefined>;
	stream = new Signal<AudioStreamTrack | undefined>(undefined);

	signals = new Effect();

	constructor(props?: MicrophoneProps) {
		this.device = Signal.from(props?.device);
		this.enabled = Signal.from(props?.enabled ?? false);
		this.constraints = Signal.from(props?.constraints);

		this.signals.effect((effect) => {
			effect.event(navigator.mediaDevices, "devicechange", effect.reload.bind(effect));
			effect.spawn(this.#runDevices.bind(this, effect));
		});

		this.signals.effect(this.#runDevice.bind(this));

		this.signals.effect(this.#runStream.bind(this));
	}

	#runStream(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const device = effect.get(this.device);
		if (!device) return;

		const constraints = effect.get(this.constraints) ?? {};
		const finalConstraints: MediaTrackConstraints = {
			deviceId: { exact: device },
			...constraints,
		};

		effect.spawn(async (cancel) => {
			const stream = await Promise.race([
				navigator.mediaDevices.getUserMedia({ audio: finalConstraints }).catch(() => undefined),
				cancel,
			]);
			if (!stream) return;

			const track = stream.getAudioTracks()[0] as AudioStreamTrack | undefined;
			if (!track) return;

			effect.cleanup(() => track.stop());
			effect.set(this.stream, track, undefined);
		});
	}

	async #runDevices(effect: Effect, cancel: Promise<void>) {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		// Ignore permission errors for now.
		let devices = await Promise.race([navigator.mediaDevices.enumerateDevices().catch(() => []), cancel]);
		if (devices === undefined) return;

		if (!devices.length) {
			// Request permissions and try again.
			const stream = await Promise.race([
				navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => undefined),
				cancel,
			]);
			if (!stream) return; // no stream means no permissions

			for (const track of stream.getTracks()) {
				track.stop();
			}

			devices = await Promise.race([navigator.mediaDevices.enumerateDevices(), cancel]);
			if (!devices) return;
		}

		devices = devices.filter((d) => d.kind === "audioinput");
		if (!devices.length) {
			console.warn("no devices found");
			return;
		}

		// Chrome seems to have a "default" deviceId that we also need to filter out, but can be used to help us find the default device.
		const alias = devices.find((d) => d.deviceId === "default");

		// Remove the default device from the list.
		devices = devices.filter((d) => d.deviceId !== "default");

		let defaultDevice: MediaDeviceInfo | undefined;
		if (alias) {
			// Find the device with the same groupId as the default alias.
			defaultDevice = devices.find((d) => d.groupId === alias.groupId);
		}

		// If we couldn't find a default alias, time to scan labels.
		if (!defaultDevice) {
			// Look for default or communications device
			defaultDevice = devices.find((d) => {
				const label = d.label.toLowerCase();
				return label.includes("default") || label.includes("communications");
			});
		}

		if (!defaultDevice) {
			console.debug("no default device found, using first device");
			defaultDevice = devices.at(0);
		}

		effect.set(this.#devices, devices, []);
		effect.set(this.#default, defaultDevice, undefined);
	}

	#runDevice(effect: Effect) {
		const available = effect.get(this.#devices);
		if (!available) return;

		const defaultDevice = effect.get(this.#default);
		if (!defaultDevice) return;

		let selected = effect.get(this.device);
		if (selected) {
			// Make sure the selected device is available.
			if (available.some((d) => d.deviceId === selected)) return;

			console.warn("selected device not available");
			selected = undefined;
		}

		console.debug("using default device", defaultDevice.label);
		this.device.set(defaultDevice.deviceId);
	}

	close() {
		this.signals.close();
	}
}
