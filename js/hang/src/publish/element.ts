import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import * as DOM from "@kixelated/signals/dom";
import { Broadcast } from "./broadcast";
import * as Source from "./source";

// TODO: remove device; it's a backwards compatible alias for source.
// TODO remove name; it's a backwards compatible alias for path.
const OBSERVED = ["url", "name", "path", "audio", "video", "controls", "source"] as const;
type Observed = (typeof OBSERVED)[number];

type SourceType = "camera" | "screen" | "file";

// Close everything when this element is garbage collected.
const cleanup = new FinalizationRegistry<Effect>((signals) => signals.close());

export default class HangPublish extends HTMLElement {
	static observedAttributes = OBSERVED;

	url = new Signal<URL | undefined>(undefined);
	path = new Signal<Moq.Path.Valid | undefined>(undefined);
	audio = new Signal<boolean>(false);
	video = new Signal<boolean>(false);
	controls = new Signal(false);
	source = new Signal<SourceType | undefined>(undefined);
	file = new Signal<File | undefined>(undefined);

	connection: Moq.Connection.Reload;
	broadcast: Broadcast;

	#preview = new Signal<HTMLVideoElement | undefined>(undefined);
	#video = new Signal<Source.Camera | Source.Screen | undefined>(undefined);
	#audio = new Signal<Source.Microphone | Source.Screen | undefined>(undefined);
	#file = new Signal<Source.File | undefined>(undefined);

	#enabled = new Signal(false);
	#signals = new Effect();

	constructor() {
		super();

		cleanup.register(this, this.#signals);

		this.connection = new Moq.Connection.Reload({
			url: this.url,
			enabled: this.#enabled,
		});
		this.#signals.cleanup(() => this.connection.close());

		this.broadcast = new Broadcast({
			connection: this.connection.established,
			enabled: this.#enabled,
			path: this.path,

			audio: {
				enabled: this.audio,
			},
			video: {
				hd: {
					enabled: this.video,
				},
			},
		});
		this.#signals.cleanup(() => this.broadcast.close());

		// Watch to see if the preview element is added or removed.
		const observer = new MutationObserver(() => {
			this.#preview.set(this.querySelector("video") as HTMLVideoElement | undefined);
		});
		observer.observe(this, { childList: true, subtree: true });
		this.#signals.cleanup(() => observer.disconnect());

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
	}

	connectedCallback() {
		this.#enabled.set(true);
	}

	disconnectedCallback() {
		this.#enabled.set(false);
	}

	attributeChangedCallback(name: Observed, oldValue: string | null, newValue: string | null) {
		if (oldValue === newValue) return;

		if (name === "url") {
			this.url.set(newValue ? new URL(newValue) : undefined);
		} else if (name === "name" || name === "path") {
			this.path.set(newValue ? Moq.Path.from(newValue) : undefined);
		} else if (name === "source") {
			if (newValue === "camera" || newValue === "screen" || newValue === "file" || newValue === null) {
				this.source.set(newValue as SourceType | undefined);
			} else {
				throw new Error(`Invalid source: ${newValue}`);
			}
		} else if (name === "audio") {
			this.audio.set(newValue !== null);
		} else if (name === "video") {
			this.video.set(newValue !== null);
		} else if (name === "controls") {
			this.controls.set(newValue !== null);
		} else {
			const exhaustive: never = name;
			throw new Error(`Invalid attribute: ${exhaustive}`);
		}
	}

	#runSource(effect: Effect) {
		const source = effect.get(this.source);

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

		if (source === "file") {
			const fileSource = new Source.File({
				file: this.file,
			});

			fileSource.signals.effect((effect) => {
				const audio = effect.get(this.broadcast.audio.enabled);
				const video = effect.get(this.broadcast.video.hd.enabled);
				effect.set(fileSource.enabled, audio || video, false);
			});

			fileSource.signals.effect((effect) => {
				const source = effect.get(fileSource.source);
				effect.set(this.broadcast.video.source, source.video);
				effect.set(this.broadcast.audio.source, source.audio);
			});

			effect.set(this.#file, fileSource);

			effect.cleanup(() => {
				fileSource.close();
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

		DOM.render(effect, this, controls);

		effect.effect((effect) => {
			const show = effect.get(this.controls);
			if (!show) return;

			this.#renderSelect(controls, effect);
			this.#renderStatus(controls, effect);
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
		this.#renderFile(container, effect);
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
			if (this.source.peek() === "camera") {
				// Camera already selected, toggle audio.
				this.audio.update((v) => !v);
			} else {
				this.source.set("camera");
				this.audio.set(true);
			}
		});

		effect.effect((effect) => {
			const selected = effect.get(this.source);
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
			if (this.source.peek() === "camera") {
				// Camera already selected, toggle video.
				this.video.update((v) => !v);
			} else {
				this.source.set("camera");
				this.video.set(true);
			}
		});

		effect.effect((effect) => {
			const selected = effect.get(this.source);
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
			this.source.set("screen");
		});

		effect.effect((effect) => {
			const selected = effect.get(this.source);
			screen.style.opacity = selected === "screen" ? "1" : "0.5";
		});

		DOM.render(effect, parent, screen);
	}

	#renderFile(parent: HTMLDivElement, effect: Effect) {
		const fileInput = DOM.create("input", {
			type: "file",
			accept: "video/*,audio/*,image/*",
			style: { display: "none" },
		});

		const button = DOM.create(
			"button",
			{
				type: "button",
				title: "Upload File",
				style: { cursor: "pointer" },
			},
			"📁",
		);

		DOM.render(effect, parent, fileInput);
		DOM.render(effect, parent, button);

		effect.event(button, "click", () => fileInput.click());

		effect.event(fileInput, "change", (e) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			if (file) {
				this.file.set(file);
				this.source.set("file");
				this.video.set(true);
				this.audio.set(true);
				(e.target as HTMLInputElement).value = "";
			}
		});

		effect.effect((effect) => {
			const selected = effect.get(this.source);
			button.style.opacity = selected === "file" ? "1" : "0.5";
		});
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
			this.source.set(undefined);
		});

		effect.effect((effect) => {
			const selected = effect.get(this.source);
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
}

customElements.define("hang-publish", HangPublish);

declare global {
	interface HTMLElementTagNameMap {
		"hang-publish": HangPublish;
	}
}
