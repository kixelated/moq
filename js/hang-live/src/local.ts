import { Publish } from "@moq/hang";
import type * as Moq from "@moq/lite";
import { Effect, Signal } from "@moq/signals";
import Settings from "./settings";

export interface LocalProps {
	connection?: Signal<Moq.Connection.Established | undefined> | Moq.Connection.Established;
	name?: Signal<string | undefined> | string;
	avatar?: Signal<string | undefined> | string;
}
/**
 * LocalBroadcasts manages the local camera and screen broadcasts.
 * It creates them early (before joining) and can optionally render a preview.
 */
export class Local {
	connection: Signal<Moq.Connection.Established | undefined>;

	camera: Publish.Broadcast;
	microphone: Publish.Source.Microphone;
	webcam: Publish.Source.Camera;

	share: Publish.Broadcast;
	screen: Publish.Source.Screen;

	// Name and avatar signals that can be overridden
	name: Signal<string | undefined>;
	avatar: Signal<string | undefined>;

	// Set to true to join the room immediately.
	// This is static because I'm lazy.
	static join = new Signal<boolean>(false);

	#signals = new Effect();

	constructor(props?: LocalProps) {
		this.connection = Signal.from(props?.connection);

		// Use provided name/avatar or fall back to Settings
		this.name = Signal.from(props?.name ?? Settings.account.name);
		this.avatar = Signal.from(props?.avatar ?? Settings.account.avatar);

		this.webcam = new Publish.Source.Camera({
			enabled: Settings.camera.enabled,
			device: { preferred: Settings.camera.device },
			constraints: {
				width: { ideal: 640 },
				height: { ideal: 640 },
				frameRate: { ideal: 60 },
				facingMode: { ideal: "user" },
				resizeMode: "none",
			},
		});
		this.#signals.cleanup(() => this.webcam.close());

		this.microphone = new Publish.Source.Microphone({
			enabled: Settings.microphone.enabled,
			device: { preferred: Settings.microphone.device },
			constraints: {
				channelCount: { ideal: 1, max: 2 },
				autoGainControl: { ideal: true },
				noiseSuppression: { ideal: true },
				echoCancellation: { ideal: true },
			},
		});
		this.#signals.cleanup(() => this.microphone.close());

		// Create the camera broadcast
		this.camera = new Publish.Broadcast({
			enabled: Local.join,
			connection: this.connection,
			user: {
				enabled: true,
				name: this.name,
				avatar: this.avatar,
			},
			video: {
				source: this.webcam.source,
				hd: {
					enabled: Settings.camera.enabled,
					config: {
						maxPixels: 640 * 640,
					},
				},
				sd: {
					enabled: Settings.camera.enabled,
					config: {
						maxPixels: 320 * 320,
					},
				},
				flip: true,
			},
			audio: {
				enabled: Settings.microphone.enabled,
				volume: Settings.microphone.gain,
				source: this.microphone.source,
			},
			location: {
				window: {
					enabled: true,
					//position: { x: Math.random() - 0.5, y: Math.random() - 0.5 },
					handle: Math.random().toString(36).substring(2, 15),
				},
				peers: {
					enabled: true,
				},
			},
			chat: {
				message: {
					enabled: true,
				},
				typing: {
					enabled: true,
				},
			},
			preview: {
				enabled: true,
				info: {
					chat: false,
					typing: false,
					screen: false,
				},
			},
		});

		this.screen = new Publish.Source.Screen({
			video: {
				frameRate: { ideal: 60 },
				resizeMode: "none",
				width: { max: 1920 },
				height: { max: 1920 },
			},
			audio: {
				channelCount: { ideal: 2, max: 2 },
				autoGainControl: { ideal: false },
				echoCancellation: { ideal: false },
				noiseSuppression: { ideal: false },
			},
		});
		this.#signals.cleanup(() => this.screen.close());

		// Create the screen broadcast
		this.share = new Publish.Broadcast({
			connection: this.connection,
			audio: {
				enabled: this.screen.enabled,
			},
			video: {
				hd: {
					enabled: this.screen.enabled,
					config: {
						maxPixels: 1200 * 1200,
						bitrateScale: 0.08,
					},
				},
				// TODO only enable for large enough screen
				sd: {
					enabled: this.screen.enabled,
					config: {
						maxPixels: 600 * 600,
						bitrateScale: 0.06,
					},
				},
			},
			location: {
				window: {
					enabled: true,
					position: { x: Math.random() - 0.5, y: Math.random() - 0.5 },
					handle: Math.random().toString(36).substring(2, 15),
				},
				peers: {
					enabled: Settings.draggable,
				},
			},
		});

		this.#signals.effect((effect) => {
			const source = effect.get(this.screen.source);
			if (!source) return;

			effect.set(this.share.audio.source, source.audio);
			effect.set(this.share.video.source, source.video);
			effect.set(this.share.enabled, true, false); // only enable once there is a stream
		});

		this.camera.signals.effect((effect) => {
			const message = effect.get(this.camera.chat.message.latest);
			this.camera.preview.info.update((prev) => ({
				...prev,
				chat: !!message,
			}));
		});

		this.camera.signals.effect((effect) => {
			const message = effect.get(this.camera.chat.message.latest);
			if (!message) return;

			// Clear the message after 10 seconds.
			effect.timer(() => {
				this.camera.chat.message.latest.set("");
			}, 10000);
		});

		this.camera.signals.effect((effect) => {
			const video = effect.get(this.camera.video.source);
			const audio = effect.get(this.camera.audio.source);

			this.camera.preview.info.update((prev) => ({
				...prev,
				video: !!video,
				audio: !!audio,
			}));
		});

		// Update the screen sharing status
		this.share.signals.effect((effect) => {
			const video = effect.get(this.share.video.source);
			const audio = effect.get(this.share.audio.source);

			this.camera.preview.info.update((prev) => ({
				...prev,
				screen: !!video || !!audio,
			}));
		});

		// Enable the screen when a media device is selected.
		this.share.signals.effect((effect) => {
			const join = effect.get(Local.join);
			if (!join) return;

			const active = !!effect.get(this.share.video.source) || !!effect.get(this.share.audio.source);
			if (!active) return;

			effect.set(this.share.enabled, true, false);
			effect.cleanup(() => this.share.enabled.set(false));
		});

		this.#signals.effect((effect) => {
			const name = effect.get(Settings.account.name);
			if (!name) return;

			if (name.endsWith("s")) {
				this.share.user.name.set(`${name}' Screen`);
			} else {
				this.share.user.name.set(`${name}'s Screen`);
			}
		});

		this.#signals.effect((effect) => {
			const name = effect.get(Settings.account.name);
			this.camera.preview.info.update((prev) => ({ ...prev, name }));
		});

		this.#signals.effect((effect) => {
			const avatar = effect.get(Settings.account.avatar);
			this.camera.preview.info.update((prev) => ({ ...prev, avatar }));
		});
	}

	close() {
		this.#signals.close();
		this.camera.close();
		this.share.close();
	}
}
