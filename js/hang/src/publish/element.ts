import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import { Broadcast } from "./broadcast";
import * as Source from "./source";
// import type { HangPublishControlsElement, PublishSourceType } from "@kixelated/hang-ui/publish/element";

// TODO: remove device; it's a backwards compatible alias for source.
// TODO remove name; it's a backwards compatible alias for path.
const OBSERVED = ["url", "name", "path", "device", "audio", "video", "controls", "source"] as const;
type Observed = (typeof OBSERVED)[number];

export type SourceType = "camera" | "screen";

export interface HangPublishSignals {
	url: Signal<URL | undefined>;
	path: Signal<Moq.Path.Valid | undefined>;
	device: Signal<SourceType | undefined>;
	audio: Signal<boolean>;
	video: Signal<boolean>;
	controls: Signal<boolean>;
	source: Signal<SourceType | undefined>;
}

export default class HangPublish extends HTMLElement {
	static observedAttributes = OBSERVED;

	signals: HangPublishSignals = {
		url: new Signal<URL | undefined>(undefined),
		path: new Signal<Moq.Path.Valid | undefined>(undefined),
		device: new Signal<SourceType | undefined>(undefined),
		audio: new Signal<boolean>(false),
		video: new Signal<boolean>(false),
		controls: new Signal(false),
		source: new Signal<SourceType | undefined>(undefined),
	};

	active = new Signal<HangPublishInstance | undefined>(undefined);

	connectedCallback() {
		this.active.set(new HangPublishInstance(this));

		this.dispatchEvent(new CustomEvent('publish-instance-available', {
			detail: {
				instance: this.active,
			}
		}));
	}

	disconnectedCallback() {
		this.active.update((prev) => {
			prev?.close();
			return undefined;
		});
	}

	attributeChangedCallback(name: Observed, oldValue: string | null, newValue: string | null) {
		if (oldValue === newValue) return;

		if (name === "url") {
			this.url = newValue ? new URL(newValue) : undefined;
		} else if (name === "name" || name === "path") {
			this.path = newValue ?? undefined;
		} else if (name === "device" || name === "source") {
			if (newValue === "camera" || newValue === "screen" || newValue === null) {
				this.source = newValue ?? undefined;
			} else {
				throw new Error(`Invalid device: ${newValue}`);
			}
		} else if (name === "audio") {
			this.audio = newValue !== null;
		} else if (name === "video") {
			this.video = newValue !== null;
		} else if (name === "controls") {
			this.controls = newValue !== null;
		} else {
			const exhaustive: never = name;
			throw new Error(`Invalid attribute: ${exhaustive}`);
		}
	}

	get url(): URL | undefined {
		return this.signals.url.peek();
	}

	set url(url: URL | undefined) {
		this.signals.url.set(url);
	}

	get name(): string | undefined {
		return this.path;
	}

	set name(name: string | undefined) {
		this.path = name;
	}

	get path(): string | undefined {
		return this.signals.path.peek()?.toString();
	}

	set path(name: string | undefined) {
		this.signals.path.set(name ? Moq.Path.from(name) : undefined);
	}

	// TODO: remove device; it's a backwards compatible alias for source.
	get device(): SourceType | undefined {
		return this.source;
	}

	set device(device: SourceType | undefined) {
		this.source = device;
	}

	get source(): SourceType | undefined {
		return this.signals.source.peek();
	}

	set source(source: SourceType | undefined) {
		this.signals.source.set(source);
	}

	get audio(): boolean {
		return this.signals.audio.peek();
	}

	set audio(audio: boolean) {
		this.signals.audio.set(audio);
	}

	get video(): boolean {
		return this.signals.video.peek();
	}

	set video(video: boolean) {
		this.signals.video.set(video);
	}

	get controls(): boolean {
		return this.signals.controls.peek();
	}

	set controls(controls: boolean) {
		this.signals.controls.set(controls);
	}

	set videoDevice(sourceId: MediaDeviceInfo['deviceId']) {
		const hangPublishInstance = this.active.peek();
        if (!hangPublishInstance) return;

        const video = hangPublishInstance.video?.peek();

        if (!video || !('device' in video)) return;

        video.device.preferred.set(sourceId);
	}

	set audioDevice(sourceId: MediaDeviceInfo['deviceId']) {
		const hangPublishInstance = this.active.peek();
        if (!hangPublishInstance) return;

        const audio = hangPublishInstance.audio?.peek();

        if (!audio || !('device' in audio)) return;

        audio.device.preferred.set(sourceId);
	}
}

export class HangPublishInstance {
	parent: HangPublish;
	connection: Moq.Connection.Reload;
	broadcast: Broadcast;

	#preview: Signal<HTMLVideoElement | undefined>;
	// #controlsElement: HangPublishControlsElement | undefined;
	video = new Signal<Source.Camera | Source.Screen | undefined>(undefined);
	audio = new Signal<Source.Microphone | Source.Screen | undefined>(undefined);
	signals = new Effect();

	#controlsElement: unknown;

	constructor(parent: HangPublish) {
		this.parent = parent;

		// Watch to see if the preview element is added or removed.
		this.#preview = new Signal(this.parent.querySelector("video") as HTMLVideoElement | undefined);
		// this.#controlsElement = this.parent.querySelector("hang-publish-controls");
		const observer = new MutationObserver(() => {
			this.#preview.set(this.parent.querySelector("video") as HTMLVideoElement | undefined);
		});
		observer.observe(this.parent, { childList: true, subtree: true });
		this.signals.cleanup(() => observer.disconnect());

		this.connection = new Moq.Connection.Reload({
			enabled: true,
			url: this.parent.signals.url,
		});

		this.broadcast = new Broadcast({
			connection: this.connection.established,
			enabled: true, // TODO allow configuring this
			path: this.parent.signals.path,

			audio: {
				enabled: this.parent.signals.audio,
			},
			video: {
				hd: {
					enabled: this.parent.signals.video,
				},
			},
		});

		this.signals.effect((effect) => {
			const preview = effect.get(this.#preview);
			if (!preview) return;

			const source = effect.get(this.broadcast.video.source);
			if (!source) {
				preview.style.display = "none";
				return;
			}

			preview.srcObject = new MediaStream([source]);
			preview.style.display = "block";

			effect.cleanup(() => {
				preview.srcObject = null;
			});
		});

		this.signals.effect(this.#runSource.bind(this));
		this.signals.effect(this.#connectControls.bind(this));

		// Keep device signal in sync with source signal for backwards compatibility
		this.signals.effect((effect) => {
			const source = effect.get(this.parent.signals.source);
			effect.set(this.parent.signals.device, source);
		});
	}

	#runSource(effect: Effect) {
		const source = effect.get(this.parent.signals.source);

		if (source === "camera") {
			const video = new Source.Camera({ enabled: this.broadcast.video.hd.enabled });
			video.signals.effect((effect) => {
				const source = effect.get(video.source);
				effect.set(this.broadcast.video.source, source);
			});

			const audio = new Source.Microphone({ enabled: this.broadcast.audio.enabled });
			audio.signals.effect((effect) => {
				const source = effect.get(audio.source);
				effect.set(this.broadcast.audio.source, source);
			});

			effect.set(this.video, video);
			effect.set(this.audio, audio);

			effect.cleanup(() => {
				video.close();
				audio.close();
			});

			return;
		}

		if (source === "screen") {
			const screen = new Source.Screen();

			screen.signals.effect((effect) => {
				const source = effect.get(screen.source);
				if (!source) return;

				effect.set(this.broadcast.video.source, source.video);
				effect.set(this.broadcast.audio.source, source.audio);
			});

			screen.signals.effect((effect) => {
				const audio = effect.get(this.broadcast.audio.enabled);
				const video = effect.get(this.broadcast.video.hd.enabled);
				effect.set(screen.enabled, audio || video, false);
			});

			effect.set(this.video, screen);
			effect.set(this.audio, screen);

			effect.cleanup(() => {
				screen.close();
			});

			return;
		}
	}

	#connectControls() {
		if (!this.#controlsElement) {
			console.warn("No controls element found");
			return;
		}

		// const shouldShowControls = effect.get(this.parent.signals.controls);
		// hideShowControls(this.#controlsElement, shouldShowControls);

		// effect.effect((effect) => {
		// 	const showControls = effect.get(this.parent.signals.controls);
		// 	hideShowControls(this.#controlsElement, showControls);
		// });

		// this.#setupStatusControls(effect);

		// effect.event(this.#controlsElement, "sourceselectionchange", (source: Event) => {
		// 	const selection = (source as CustomEvent).detail as PublishSourceType;
			
		// 	if (selection === 'camera') {
		// 		if (this.parent.source === "camera") {
		// 			// Camera already selected, toggle video.
		// 			this.parent.video = !this.parent.video;
		// 		} else {
		// 			this.parent.source = "camera";
		// 			this.parent.video = true;
		// 		}
		// 	}

		// 	if (selection === 'microphone') {
		// 		if (this.parent.source === "camera") {
		// 			// Camera already selected, toggle audio.
		// 			this.parent.audio = !this.parent.audio;
		// 		} else {
		// 			this.parent.source = "camera";
		// 			this.parent.audio = true;
		// 		}
		// 	}

		// 	if (selection === 'screen') {
		// 		this.parent.source = "screen";
		// 	}

		// 	if (selection === 'nothing') {
		// 		this.parent.source = undefined;
		// 	}
		// });

		// effect.event(this.#controlsElement, "camerasourceselected", (event: Event) => {
		// 	const detail = (event as CustomEvent).detail as MediaDeviceInfo['deviceId'];
		// 	const video = effect.get(this.#video);
		// 	if (video instanceof Source.Camera) {
		// 		video.device.preferred.set(detail);
		// 	}
		// });

		// effect.event(this.#controlsElement, "microphonesourceselected", (event: Event) => {
		// 	const detail = (event as CustomEvent).detail as MediaDeviceInfo['deviceId'];
		// 	const audio = effect.get(this.#audio);
		// 	if (audio instanceof Source.Microphone) {
		// 		audio.device.preferred.set(detail);
		// 	}
		// });

		// // Provide available video devices to PublishControls.
		// effect.effect((effect) => {
		// 	if (!this.#controlsElement) return;

		// 	const video = effect.get(this.#video);
		// 	if (!(video instanceof Source.Camera)) return;

		// 	const enabled = effect.get(this.broadcast.video.hd.enabled);
		// 	if (!enabled) return;

		// 	const devices = effect.get(video.device.available);
		// 	if (!devices || devices.length < 2) return;

		// 	this.#controlsElement.cameraSources = devices;
		// 	this.#controlsElement.selectedCameraSource = effect.get(video.device.requested);
		// });

		// // Provide available audio devices to PublishControls.
		// effect.effect((effect) => {
		// 	if (!this.#controlsElement) return;

		// 	const audio = effect.get(this.#audio);
		// 	if (!(audio instanceof Source.Microphone)) return;

		// 	const enabled = effect.get(this.broadcast.audio.enabled);
		// 	if (!enabled) return;

		// 	const devices = effect.get(audio.device.available);
		// 	if (!devices || devices.length < 2) return;

		// 	this.#controlsElement.microphoneSources = devices;
		// 	this.#controlsElement.selectedMicrophoneSource = effect.get(audio.device.requested);
		// });

		// // Update active sources.
		// effect.effect((effect) => {
		// 	if (!this.#controlsElement) return;

		// 	const activeSources: PublishSourceType[] = [];
		// 	const audio = effect.get(this.#audio);
		// 	const videoSource = effect.get(this.parent.signals.source);

		// 	// update active sources while we have values 
		// 	if (audio) activeSources.push("microphone");
		// 	if (videoSource === "camera") activeSources.push("camera");
		// 	if (videoSource === "screen") activeSources.push("screen");

		// 	this.#controlsElement.activeSources = activeSources;
		// });

		// function hideShowControls(element: HangPublishControlsElement | undefined, show: boolean) {
		// 	if (!element) return;
			
		// 	if (show) {
		// 		element.style.display = "block";
		// 	} else {
		// 		element.style.display = "none";
		// 	}
		// }
	}

	close() {
		this.signals.close();
		this.broadcast.close();
		this.connection.close();
	}
}

customElements.define("hang-publish", HangPublish);

declare global {
	interface HTMLElementTagNameMap {
		"hang-publish": HangPublish;
	}
}
