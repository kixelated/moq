import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import * as DOM from "@kixelated/signals/dom";
import { Connection } from "../connection";
import { Broadcast } from "./broadcast";
import * as Source from "./source";

// TODO: remove device; it's a backwards compatible alias for source.
const OBSERVED = ["url", "name", "device", "audio", "video", "controls", "captions", "source"] as const;
type Observed = (typeof OBSERVED)[number];

type SourceType = "camera" | "screen";

export default class HangPublish extends HTMLElement {
	static observedAttributes = OBSERVED;

	#controls = new Signal(false);

	connection: Connection;
	broadcast: Broadcast;

	#source = new Signal<SourceType | undefined>(undefined);
	#video = new Signal<Source.Camera | Source.Screen | undefined>(undefined);
	#audio = new Signal<Source.Microphone | Source.Screen | undefined>(undefined);

	#signals = new Effect();

	constructor() {
		super();

		const preview = this.querySelector("video") as HTMLVideoElement | undefined;

		this.connection = new Connection();
		this.broadcast = new Broadcast(this.connection);

		// Only publish when we have media available.
		// TODO Configurable?
		this.#signals.effect((effect) => {
			const audio = effect.get(this.broadcast.audio.source);
			const video = effect.get(this.broadcast.video.source);
			this.broadcast.enabled.set(!!audio || !!video);
		});

		this.#signals.effect((effect) => {
			if (!preview) return;

			const media = effect.get(this.broadcast.video.source);
			if (!media) {
				preview.style.display = "none";
				return;
			}

			preview.srcObject = new MediaStream([media]);
			preview.style.display = "block";

			effect.cleanup(() => {
				preview.srcObject = null;
			});
		});

		this.#renderControls();
		this.#renderCaptions();
	}

	attributeChangedCallback(name: Observed, oldValue: string | null, newValue: string | null) {
		if (oldValue === newValue) return;

		if (name === "url") {
			this.url = newValue ? new URL(newValue) : undefined;
		} else if (name === "name") {
			this.name = newValue ?? undefined;
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
		return this.connection.url.peek();
	}

	set url(url: URL | undefined) {
		this.connection.url.set(url);
	}

	get name(): string | undefined {
		return this.broadcast.name.peek()?.toString();
	}

	set name(name: string | undefined) {
		this.broadcast.name.set(name ? Moq.Path.from(name) : undefined);
	}

	get device(): SourceType | undefined {
		return this.source;
	}

	set device(device: SourceType | undefined) {
		this.source = device;
	}

	get source(): SourceType | undefined {
		return this.#source.peek();
	}

	set source(source: SourceType | undefined) {
		if (source === this.#source.peek()) return;

		this.#audio.peek()?.close();
		this.#video.peek()?.close();

		if (source === "camera") {
			const video = new Source.Camera({ enabled: this.broadcast.video.enabled });
			video.signals.effect((effect) => {
				const stream = effect.get(video.stream);
				effect.set(this.broadcast.video.source, stream);
			});

			const audio = new Source.Microphone({ enabled: this.broadcast.audio.enabled });
			audio.signals.effect((effect) => {
				const stream = effect.get(audio.stream);
				effect.set(this.broadcast.audio.source, stream);
			});

			this.#video.set(video);
			this.#audio.set(audio);
		} else if (source === "screen") {
			const screen = new Source.Screen();

			screen.signals.effect((effect) => {
				const stream = effect.get(screen.stream);
				if (!stream) return;

				effect.set(this.broadcast.video.source, stream.video);
				effect.set(this.broadcast.audio.source, stream.audio);
			});

			screen.signals.effect((effect) => {
				const audio = effect.get(this.broadcast.audio.enabled);
				const video = effect.get(this.broadcast.video.enabled);
				effect.set(screen.enabled, audio || video, false);
			});

			this.#video.set(screen);
			this.#audio.set(screen);
		} else {
			this.#video.set(undefined);
			this.#audio.set(undefined);
		}

		this.#source.set(source);
	}

	get audio(): boolean {
		return this.broadcast.audio.enabled.peek();
	}

	set audio(audio: boolean) {
		this.broadcast.audio.enabled.set(audio);
	}

	get video(): boolean {
		return this.broadcast.video.enabled.peek();
	}

	set video(video: boolean) {
		this.broadcast.video.enabled.set(video);
	}

	get controls(): boolean {
		return this.#controls.peek();
	}

	set controls(controls: boolean) {
		this.#controls.set(controls);
	}

	get captions(): boolean {
		return this.broadcast.audio.captions.enabled.peek();
	}

	set captions(captions: boolean) {
		this.broadcast.audio.captions.enabled.set(captions);
		this.broadcast.audio.speaking.enabled.set(captions);
	}

	#renderControls() {
		const controls = DOM.create("div", {
			style: {
				display: "flex",
				justifyContent: "space-around",
				gap: "16px",
				margin: "8px 0",
				alignContent: "center",
			},
		});

		this.appendChild(controls);
		this.#signals.cleanup(() => this.removeChild(controls));

		this.#signals.effect((effect) => {
			const show = effect.get(this.#controls);
			if (!show) return;

			this.#renderSelect(controls, effect);
			this.#renderStatus(controls, effect);
		});
	}

	#renderCaptions() {
		const captions = DOM.create("div", {
			style: {
				display: "flex",
				justifyContent: "space-around",
				gap: "16px",
				minHeight: "1lh",
				alignContent: "center",
			},
		});

		this.appendChild(captions);
		this.#signals.cleanup(() => this.removeChild(captions));

		this.#signals.effect((effect) => {
			const show = effect.get(this.broadcast.audio.captions.enabled);
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

			captions.appendChild(leftSpacer);
			captions.appendChild(captionText);
			captions.appendChild(speakingIcon);

			effect.cleanup(() => {
				captions.removeChild(leftSpacer);
				captions.removeChild(captionText);
				captions.removeChild(speakingIcon);
			});
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

		parent.appendChild(container);
		effect.cleanup(() => parent.removeChild(container));
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
			if (this.source === "camera") {
				// Camera already selected, toggle audio.
				this.audio = !this.audio;
			} else {
				this.source = "camera";
				this.audio = true;
			}
		});

		effect.effect((effect) => {
			const selected = effect.get(this.#source);
			const audio = effect.get(this.broadcast.audio.enabled);
			microphone.style.opacity = selected === "camera" && audio ? "1" : "0.5";
		});

		// List of the available audio devices and show a drop down if there are multiple.
		effect.effect((effect) => {
			const audio = effect.get(this.#audio);
			if (!(audio instanceof Source.Microphone)) return;

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
			effect.event(select, "change", () => audio.device.preferred.set(select.value));

			for (const device of devices) {
				const option = DOM.create("option", { value: device.deviceId }, device.label);
				DOM.render(effect, select, option);
			}

			effect.effect((effect) => {
				const selected = effect.get(audio.device.selected);
				select.value = selected?.deviceId ?? "";
			});

			const caret = DOM.create("span", { style: { fontSize: "0.75em", cursor: "pointer" } }, "▼");
			effect.event(caret, "click", () => visible.set((v) => !v));

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
			if (this.source === "camera") {
				// Camera already selected, toggle video.
				this.video = !this.video;
			} else {
				this.source = "camera";
				this.video = true;
			}
		});

		effect.effect((effect) => {
			const selected = effect.get(this.#source);
			const video = effect.get(this.broadcast.video.enabled);
			camera.style.opacity = selected === "camera" && video ? "1" : "0.5";
		});

		// List of the available audio devices and show a drop down if there are multiple.
		effect.effect((effect) => {
			const video = effect.get(this.#video);
			if (!(video instanceof Source.Camera)) return;

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
			effect.event(select, "change", () => video.device.preferred.set(select.value));

			for (const device of devices) {
				const option = DOM.create("option", { value: device.deviceId }, device.label);
				DOM.render(effect, select, option);
			}

			effect.effect((effect) => {
				const selected = effect.get(video.device.selected);
				select.value = selected?.deviceId ?? "";
			});

			const caret = DOM.create("span", { style: { fontSize: "0.75em", cursor: "pointer" } }, "▼");
			effect.event(caret, "click", () => visible.set((v) => !v));

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
			this.source = "screen";
		});

		effect.effect((effect) => {
			const selected = effect.get(this.#source);
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
			this.source = undefined;
		});

		effect.effect((effect) => {
			const selected = effect.get(this.#source);
			nothing.style.opacity = selected === undefined ? "1" : "0.5";
		});

		DOM.render(effect, parent, nothing);
	}

	#renderStatus(parent: HTMLDivElement, effect: Effect) {
		const container = DOM.create("div");

		effect.effect((effect) => {
			const url = effect.get(this.broadcast.connection.url);
			const status = effect.get(this.broadcast.connection.status);
			const audio = effect.get(this.broadcast.audio.source);
			const video = effect.get(this.broadcast.video.source);

			if (!url) {
				container.textContent = "🔴\u00A0No URL";
			} else if (status === "disconnected") {
				container.textContent = "🔴\u00A0Disconnected";
			} else if (status === "connecting") {
				container.textContent = "🟡\u00A0Connecting...";
			} else if (!audio && !video) {
				container.textContent = "🟡\u00A0Select Device";
			} else if (!audio && video) {
				container.textContent = "🟡\u00A0Video Only";
			} else if (audio && !video) {
				container.textContent = "🟡\u00A0Audio Only";
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
