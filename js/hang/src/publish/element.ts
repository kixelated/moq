import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import * as DOM from "@kixelated/signals/dom";
import { Broadcast } from "./broadcast";
import * as Source from "./source";

// TODO: remove device; it's a backwards compatible alias for source.
// TODO remove name; it's a backwards compatible alias for path.
const OBSERVED = ["url", "name", "path", "device", "audio", "video", "controls", "captions", "source"] as const;
type Observed = (typeof OBSERVED)[number];

type SourceType = "camera" | "screen";

export interface HangPublishSignals {
	url: Signal<URL | undefined>;
	path: Signal<Moq.Path.Valid | undefined>;
	device: Signal<SourceType | undefined>;
	audio: Signal<boolean>;
	video: Signal<boolean>;
	controls: Signal<boolean>;
	captions: Signal<boolean>;
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
		captions: new Signal(false),
		source: new Signal<SourceType | undefined>(undefined),
	};

	active = new Signal<HangPublishInstance | undefined>(undefined);

	connectedCallback() {
		this.active.set(new HangPublishInstance(this));
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
		} else if (name === "captions") {
			this.captions = newValue !== null;
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

	get captions(): boolean {
		return this.signals.captions.peek();
	}

	set captions(captions: boolean) {
		this.signals.captions.set(captions);
	}
}

class HangPublishInstance {
	parent: HangPublish;
	connection: Moq.Connection.Reload;
	broadcast: Broadcast;

	#preview: Signal<HTMLVideoElement | undefined>;
	#video = new Signal<Source.Camera | Source.Screen | undefined>(undefined);
	#audio = new Signal<Source.Microphone | Source.Screen | undefined>(undefined);

	#signals = new Effect();

	constructor(parent: HangPublish) {
		this.parent = parent;

		// Watch to see if the preview element is added or removed.
		this.#preview = new Signal(this.parent.querySelector("video") as HTMLVideoElement | undefined);
		const observer = new MutationObserver(() => {
			this.#preview.set(this.parent.querySelector("video") as HTMLVideoElement | undefined);
		});
		observer.observe(this.parent, { childList: true, subtree: true });
		this.#signals.cleanup(() => observer.disconnect());

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
				captions: {
					enabled: this.parent.signals.captions,
				},
				speaking: {
					enabled: this.parent.signals.captions,
				},
			},
			video: {
				hd: {
					enabled: this.parent.signals.video,
				},
			},
		});

		this.#signals.effect((effect) => {
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

		this.#signals.effect(this.#runSource.bind(this));
		this.#signals.effect(this.#renderControls.bind(this));
		this.#signals.effect(this.#renderCaptions.bind(this));

		// Keep device signal in sync with source signal for backwards compatibility
		this.#signals.effect((effect) => {
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

			effect.set(this.#video, video);
			effect.set(this.#audio, audio);

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

			effect.set(this.#video, screen);
			effect.set(this.#audio, screen);

			effect.cleanup(() => {
				screen.close();
			});

			return;
		}
	}

	#renderControls(effect: Effect) {
		const controls = DOM.create("div", {
			style: {
				display: "flex",
				justifyContent: "space-around",
				gap: "16px",
				margin: "8px 0",
				alignContent: "center",
			},
		});

		DOM.render(effect, this.parent, controls);

		effect.effect((effect) => {
			const show = effect.get(this.parent.signals.controls);
			if (!show) return;

			this.#renderSelect(controls, effect);
			this.#renderStatus(controls, effect);
		});
	}

	#renderCaptions(effect: Effect) {
		const captions = DOM.create("div", {
			style: {
				display: "flex",
				justifyContent: "space-around",
				gap: "16px",
				minHeight: "1lh",
				alignContent: "center",
			},
		});

		DOM.render(effect, this.parent, captions);

		effect.effect((effect) => {
			const show = effect.get(this.parent.signals.captions);
			if (!show) return;

			const leftSpacer = DOM.create("div", {
				style: { width: "1.5em" },
			});

			const captionText = DOM.create("div", {
				style: { textAlign: "center" },
			});

			const speakingIcon = DOM.create("div", {
				style: { width: "1.5em" },
			});

			effect.effect((effect) => {
				const text = effect.get(this.broadcast.audio.captions.text);
				const speaking = effect.get(this.broadcast.audio.speaking.active);

				captionText.textContent = text ?? "";
				speakingIcon.textContent = speaking ? "🗣️" : " ";
			});

			DOM.render(effect, captions, leftSpacer);
			DOM.render(effect, captions, captionText);
			DOM.render(effect, captions, speakingIcon);
		});
	}

	#renderSelect(parent: HTMLDivElement, effect: Effect) {
		const container = DOM.create(
			"div",
			{
				style: {
					display: "flex",
					gap: "16px",
				},
			},
			"Source:",
		);

		this.#renderMicrophone(container, effect);
		this.#renderCamera(container, effect);
		this.#renderScreen(container, effect);
		this.#renderNothing(container, effect);

		DOM.render(effect, parent, container);
	}

	#renderMicrophone(parent: HTMLDivElement, effect: Effect) {
		const container = DOM.create("div", {
			style: {
				display: "flex",
				position: "relative",
				alignItems: "center",
			},
		});

		const microphone = DOM.create(
			"button",
			{
				type: "button",
				title: "Microphone",
				style: { cursor: "pointer" },
			},
			"🎤",
		);

		DOM.render(effect, container, microphone);

		effect.event(microphone, "click", () => {
			if (this.parent.source === "camera") {
				// Camera already selected, toggle audio.
				this.parent.audio = !this.parent.audio;
			} else {
				this.parent.source = "camera";
				this.parent.audio = true;
			}
		});

		effect.effect((effect) => {
			const selected = effect.get(this.parent.signals.source);
			const audio = effect.get(this.broadcast.audio.enabled);
			microphone.style.opacity = selected === "camera" && audio ? "1" : "0.5";
		});

		// List of the available audio devices and show a drop down if there are multiple.
		effect.effect((effect) => {
			const audio = effect.get(this.#audio);
			if (!(audio instanceof Source.Microphone)) return;

			const enabled = effect.get(this.broadcast.audio.enabled);
			if (!enabled) return;

			const devices = effect.get(audio.device.available);
			if (!devices || devices.length < 2) return;

			const visible = new Signal(false);

			const select = DOM.create("select", {
				style: {
					position: "absolute",
					top: "100%",
					transform: "translateX(-50%)",
				},
			});
			effect.event(select, "change", () => {
				audio.device.preferred.set(select.value);
			});

			for (const device of devices) {
				const option = DOM.create("option", { value: device.deviceId }, device.label);
				DOM.render(effect, select, option);
			}

			effect.effect((effect) => {
				const active = effect.get(audio.device.requested);
				select.value = active ?? "";
			});

			const caret = DOM.create("span", { style: { fontSize: "0.75em", cursor: "pointer" } }, "▼");
			effect.event(caret, "click", () => visible.update((v) => !v));

			effect.effect((effect) => {
				const v = effect.get(visible);
				caret.innerText = v ? "▼" : "▲";
				select.style.display = v ? "block" : "none";
			});

			DOM.render(effect, container, caret);
			DOM.render(effect, container, select);
		});

		DOM.render(effect, parent, container);
	}

	#renderCamera(parent: HTMLDivElement, effect: Effect) {
		const container = DOM.create("div", {
			style: {
				display: "flex",
				position: "relative",
				alignItems: "center",
			},
		});

		const camera = DOM.create(
			"button",
			{
				type: "button",
				title: "Camera",
				style: { cursor: "pointer" },
			},
			"📷",
		);

		DOM.render(effect, container, camera);

		effect.event(camera, "click", () => {
			if (this.parent.source === "camera") {
				// Camera already selected, toggle video.
				this.parent.video = !this.parent.video;
			} else {
				this.parent.source = "camera";
				this.parent.video = true;
			}
		});

		effect.effect((effect) => {
			const selected = effect.get(this.parent.signals.source);
			const video = effect.get(this.broadcast.video.hd.enabled);
			camera.style.opacity = selected === "camera" && video ? "1" : "0.5";
		});

		// List of the available audio devices and show a drop down if there are multiple.
		effect.effect((effect) => {
			const video = effect.get(this.#video);
			if (!(video instanceof Source.Camera)) return;

			const enabled = effect.get(this.broadcast.video.hd.enabled);
			if (!enabled) return;

			const devices = effect.get(video.device.available);
			if (!devices || devices.length < 2) return;

			const visible = new Signal(false);

			const select = DOM.create("select", {
				style: {
					position: "absolute",
					top: "100%",
					transform: "translateX(-50%)",
				},
			});
			effect.event(select, "change", () => {
				video.device.preferred.set(select.value);
			});

			for (const device of devices) {
				const option = DOM.create("option", { value: device.deviceId }, device.label);
				DOM.render(effect, select, option);
			}

			effect.effect((effect) => {
				const requested = effect.get(video.device.requested);
				select.value = requested ?? "";
			});

			const caret = DOM.create("span", { style: { fontSize: "0.75em", cursor: "pointer" } }, "▼");
			effect.event(caret, "click", () => visible.update((v) => !v));

			effect.effect((effect) => {
				const v = effect.get(visible);
				caret.innerText = v ? "▼" : "▲";
				select.style.display = v ? "block" : "none";
			});

			DOM.render(effect, container, caret);
			DOM.render(effect, container, select);
		});

		DOM.render(effect, parent, container);
	}

	#renderScreen(parent: HTMLDivElement, effect: Effect) {
		const screen = DOM.create(
			"button",
			{
				type: "button",
				title: "Screen",
				style: { cursor: "pointer" },
			},
			"🖥️",
		);

		effect.event(screen, "click", () => {
			this.parent.source = "screen";
		});

		effect.effect((effect) => {
			const selected = effect.get(this.parent.signals.source);
			screen.style.opacity = selected === "screen" ? "1" : "0.5";
		});

		DOM.render(effect, parent, screen);
	}

	#renderNothing(parent: HTMLDivElement, effect: Effect) {
		const nothing = DOM.create(
			"button",
			{
				type: "button",
				title: "Nothing",
				style: { cursor: "pointer" },
			},
			"🚫",
		);

		effect.event(nothing, "click", () => {
			this.parent.source = undefined;
		});

		effect.effect((effect) => {
			const selected = effect.get(this.parent.signals.source);
			nothing.style.opacity = selected === undefined ? "1" : "0.5";
		});

		DOM.render(effect, parent, nothing);
	}

	#renderStatus(parent: HTMLDivElement, effect: Effect) {
		const container = DOM.create("div");

		effect.effect((effect) => {
			const url = effect.get(this.connection.url);
			const status = effect.get(this.connection.status);
			const audio = effect.get(this.broadcast.audio.source);
			const video = effect.get(this.broadcast.video.source);

			if (!url) {
				container.textContent = "🔴\u00A0No URL";
			} else if (status === "disconnected") {
				container.textContent = "🔴\u00A0Disconnected";
			} else if (status === "connecting") {
				container.textContent = "🟡\u00A0Connecting...";
			} else if (!audio && !video) {
				container.textContent = "🟡\u00A0Select Source";
			} else if (!audio && video) {
				container.textContent = "🟢\u00A0Video Only";
			} else if (audio && !video) {
				container.textContent = "🟢\u00A0Audio Only";
			} else if (audio && video) {
				container.textContent = "🟢\u00A0Live";
			}
		});

		parent.appendChild(container);
		effect.cleanup(() => parent.removeChild(container));
	}

	close() {
		this.#signals.close();
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
