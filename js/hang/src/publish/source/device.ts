import { Effect, type Getter, Signal } from "@kixelated/signals";

export type DeviceKind = "audio" | "video";

export class Device {
	#kind: DeviceKind;

	available = new Signal<MediaDeviceInfo[]>([]);
	selected = new Signal<string | undefined>(undefined);

	#default = new Signal<MediaDeviceInfo | undefined>(undefined);
	readonly default: Getter<MediaDeviceInfo | undefined> = this.#default;

	signals = new Effect();

	constructor(kind: DeviceKind) {
		this.#kind = kind;

		this.signals.effect((effect) => {
			// This assumes that "devicechange" is fired on permission changes.
			effect.event(navigator.mediaDevices, "devicechange", effect.reload);
			effect.spawn(this.#run.bind(this, effect));
		});
	}

	async #run(effect: Effect, cancel: Promise<void>) {
		// Ignore permission errors.
		const all = navigator.mediaDevices.enumerateDevices().catch(() => []);

		const devices = await Promise.race([all, cancel]);
		if (!devices) return;

		const filtered = devices.filter((d) => d.kind === `${this.#kind}input`);
		effect.set(this.available, filtered, []);

		if (this.#kind === "audio") {
			// Look for default or communications device
			const defaultDevice = filtered.find((d) => {
				const label = d.label.toLowerCase();
				return label.includes("default") || label.includes("communications");
			});

			// If we can't find one, use undefined and hope the browser figures it out.
			effect.set(this.#default, defaultDevice, undefined);
		} else {
			// On mobile, prefer front-facing camera
			const defaultDevice = devices.find((d) => {
				const label = d.label.toLowerCase();
				return label.includes("front") || label.includes("external") || label.includes("usb");
			});

			// If we can't find one, use undefined and hope the browser figures it out.
			effect.set(this.#default, defaultDevice, undefined);
		}
	}

	close(): void {
		this.signals.close();
	}
}
