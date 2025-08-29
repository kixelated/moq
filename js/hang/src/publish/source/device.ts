import { Effect, type Getter, Signal } from "@kixelated/signals";

export interface DeviceProps {
	preferred?: string | Signal<string | undefined>;
}

export class Device<Kind extends "audio" | "video"> {
	kind: Kind;

	// The devices that are available.
	#devices = new Signal<MediaDeviceInfo[] | undefined>(undefined);
	readonly available: Getter<MediaDeviceInfo[] | undefined> = this.#devices;

	// The default device based on heuristics.
	#default = new Signal<MediaDeviceInfo | undefined>(undefined);
	readonly default: Getter<MediaDeviceInfo | undefined> = this.#default;

	// Use the preferred deviceId if available.
	preferred: Signal<string | undefined>;

	// The device that is currently selected.
	#selected = new Signal<MediaDeviceInfo | undefined>(undefined);
	readonly selected: Getter<MediaDeviceInfo | undefined> = this.#selected;

	signals = new Effect();

	constructor(kind: Kind, props?: DeviceProps) {
		this.kind = kind;
		this.preferred = Signal.from(props?.preferred);

		this.signals.effect((effect) => {
			// Reload the devices when they change.
			effect.event(navigator.mediaDevices, "devicechange", effect.reload.bind(effect));
			effect.spawn(this.#runDevices.bind(this, effect));
		});

		this.signals.effect(this.#runSelected.bind(this));
	}

	async #runDevices(effect: Effect, cancel: Promise<void>) {
		// Ignore permission errors for now.
		let devices = await Promise.race([navigator.mediaDevices.enumerateDevices().catch(() => undefined), cancel]);
		if (devices === undefined) return;

		devices = devices.filter((d) => d.kind === `${this.kind}input`);
		if (!devices.length) {
			console.warn(`no ${this.kind} devices found`);
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
			if (this.kind === "audio") {
				// Look for default or communications device
				defaultDevice = devices.find((d) => {
					const label = d.label.toLowerCase();
					return label.includes("default") || label.includes("communications");
				});
			} else if (this.kind === "video") {
				// On mobile, prefer front-facing camera
				defaultDevice = devices.find((d) => {
					const label = d.label.toLowerCase();
					return label.includes("front") || label.includes("external") || label.includes("usb");
				});
			}
		}

		console.debug("all devices", devices);
		console.debug("default device", defaultDevice);

		effect.set(this.#devices, devices, []);
		effect.set(this.#default, defaultDevice, undefined);
	}

	#runSelected(effect: Effect) {
		const available = effect.get(this.available);
		if (!available) return;

		const preferred = effect.get(this.preferred);
		if (preferred) {
			// Use the preferred deviceId if available.
			const device = available.find((d) => d.deviceId === preferred);
			if (device) {
				effect.set(this.#selected, device);
				return;
			}

			console.warn("preferred device not available, using default");
		}

		// NOTE: The default device might change, and with no (valid) preference, we should switch to it.
		const defaultDevice = effect.get(this.default);
		effect.set(this.#selected, defaultDevice);
	}

	// Manually request permission for the device, ignore the result.
	request() {
		navigator.mediaDevices
			.getUserMedia({ [this.kind]: true })
			.catch(() => undefined)
			.then((stream) => {
				stream?.getTracks().forEach((track) => {
					track.stop();
				});
			});
	}

	close() {
		this.signals.close();
	}
}
