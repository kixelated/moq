import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import * as DOM from "@kixelated/signals/dom";
import { Connection } from "../connection";
import { AudioEmitter } from "./audio";
import { Broadcast } from "./broadcast";
import { VideoRenderer } from "./video";

const OBSERVED = ["url", "name", "paused", "volume", "muted", "controls", "captions"] as const;
type Observed = (typeof OBSERVED)[number];

// An optional web component that wraps a <canvas>
export default class HangWatch extends HTMLElement {
	static observedAttributes = OBSERVED;

	#controls = new Signal(false);

	// You can construct these manually if you want to use the library without the web component.
	// However be warned that the API is still in flux and may change.
	connection: Connection;
	broadcast: Broadcast;
	video: VideoRenderer;
	audio: AudioEmitter;

	#signals = new Effect();

	constructor() {
		super();

		const canvas = this.querySelector("canvas") as HTMLCanvasElement | undefined;

		this.connection = new Connection();
		this.broadcast = new Broadcast(this.connection, { enabled: true });
		this.video = new VideoRenderer(this.broadcast.video, { canvas });
		this.audio = new AudioEmitter(this.broadcast.audio);

		// Optionally update attributes to match the library state.
		// This is kind of dangerous because it can create loops.
		this.#signals.effect((effect) => {
			const url = effect.get(this.connection.url);
			if (url) {
				this.setAttribute("url", url.toString());
			} else {
				this.removeAttribute("url");
			}
		});

		this.#signals.effect((effect) => {
			const broadcast = effect.get(this.broadcast.name);
			if (broadcast) {
				this.setAttribute("name", broadcast.toString());
			} else {
				this.removeAttribute("name");
			}
		});

		this.#signals.effect((effect) => {
			const muted = effect.get(this.audio.muted);
			if (muted) {
				this.setAttribute("muted", "");
			} else {
				this.removeAttribute("muted");
			}
		});

		this.#signals.effect((effect) => {
			const paused = effect.get(this.video.paused);
			if (paused) {
				this.setAttribute("paused", "true");
			} else {
				this.removeAttribute("paused");
			}
		});

		this.#signals.effect((effect) => {
			const volume = effect.get(this.audio.volume);
			this.setAttribute("volume", volume.toString());
		});

		this.#signals.effect((effect) => {
			const controls = effect.get(this.#controls);
			if (controls) {
				this.setAttribute("controls", "");
			} else {
				this.removeAttribute("controls");
			}
		});

		this.#signals.effect((effect) => {
			// Don't download audio if we're muted or paused.
			const paused = effect.get(this.video.paused) || effect.get(this.audio.muted);
			this.audio.paused.set(paused);
		});

		this.#renderControls();
		this.#renderCaptions();
	}

	attributeChangedCallback(name: Observed, oldValue: string | null, newValue: string | null) {
		if (oldValue === newValue) {
			return;
		}

		if (name === "url") {
			this.url = newValue ? new URL(newValue) : undefined;
		} else if (name === "name") {
			this.name = newValue ?? undefined;
		} else if (name === "paused") {
			this.paused = newValue !== null;
		} else if (name === "volume") {
			const volume = newValue ? Number.parseFloat(newValue) : 0.5;
			this.volume = volume;
		} else if (name === "muted") {
			this.muted = newValue !== null;
		} else if (name === "controls") {
			this.controls = newValue !== null;
		} else if (name === "captions") {
			this.captions = newValue !== null;
		} else {
			const exhaustive: never = name;
			throw new Error(`Invalid attribute: ${exhaustive}`);
		}
	}

	// Make cooresponding properties for the element, more type-safe than using attributes.
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

	get paused(): boolean {
		return this.video.paused.peek();
	}

	set paused(paused: boolean) {
		this.video.paused.set(paused);
	}

	get volume(): number {
		return this.audio.volume.peek();
	}

	set volume(volume: number) {
		this.audio.volume.set(volume);
	}

	get muted(): boolean {
		return this.audio.muted.peek();
	}

	set muted(muted: boolean) {
		this.audio.muted.set(muted);
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
	}

	// TODO Do this on disconnectedCallback?
	close() {
		this.connection.close();
		this.broadcast.close();
		this.video.close();
		this.audio.close();
		this.#signals.close();
	}

	#renderControls() {
		const controls = DOM.create("div", {
			style: {
				display: "flex",
				justifyContent: "space-around",
				gap: "8px",
				alignContent: "center",
			},
		});

		this.appendChild(controls);
		this.#signals.cleanup(() => this.removeChild(controls));

		this.#signals.effect((effect) => {
			const show = effect.get(this.#controls);
			if (!show) return;

			this.#renderPause(controls, effect);
			this.#renderVolume(controls, effect);
			this.#renderStatus(controls, effect);
			this.#renderFullscreen(controls, effect);
		});
	}

	#renderCaptions() {
		const captions = DOM.create("div", {
			style: {
				textAlign: "center",
			},
		});

		this.appendChild(captions);
		this.#signals.cleanup(() => this.removeChild(captions));

		this.#signals.effect((effect) => {
			const show = effect.get(this.broadcast.audio.captions.enabled);
			if (!show) return;

			const caption = effect.get(this.broadcast.audio.captions.text);
			captions.textContent = caption ?? "";

			effect.cleanup(() => {
				captions.textContent = "";
			});
		});
	}

	#renderPause(parent: HTMLDivElement, effect: Effect) {
		const button = DOM.create("button", {
			type: "button",
			title: "Pause",
		});

		button.addEventListener("click", (e) => {
			e.preventDefault();
			this.video.paused.set((prev) => !prev);
		});

		effect.effect((effect) => {
			const paused = effect.get(this.video.paused);
			button.textContent = paused ? "▶️" : "⏸️";
		});

		parent.appendChild(button);
		effect.cleanup(() => parent.removeChild(button));
	}

	#renderVolume(parent: HTMLDivElement, effect: Effect) {
		const container = DOM.create("div", {
			style: {
				display: "flex",
				alignItems: "center",
				gap: "0.25rem",
			},
		});

		const muteButton = DOM.create("button", {
			type: "button",
			title: "Mute",
		});

		muteButton.addEventListener("click", () => {
			this.audio.muted.set((p) => !p);
		});

		const volumeSlider = DOM.create("input", {
			type: "range",
			min: "0",
			max: "100",
		});

		volumeSlider.addEventListener("input", (e) => {
			const target = e.currentTarget as HTMLInputElement;
			const volume = parseFloat(target.value) / 100;
			this.audio.volume.set(volume);
		});

		const volumeLabel = DOM.create("span", {
			style: {
				display: "inline-block",
				width: "2em",
				textAlign: "right",
			},
		});

		effect.effect((effect) => {
			const volume = effect.get(this.audio.volume);
			const rounded = Math.round(volume * 100);

			muteButton.textContent = volume === 0 ? "🔇" : "🔊";
			volumeSlider.value = (volume * 100).toString();
			volumeLabel.textContent = `${rounded}%`;
		});

		container.appendChild(muteButton);
		container.appendChild(volumeSlider);
		container.appendChild(volumeLabel);

		parent.appendChild(container);
		effect.cleanup(() => parent.removeChild(container));
	}

	#renderStatus(parent: HTMLDivElement, effect: Effect) {
		const container = DOM.create("div");

		effect.effect((effect) => {
			const url = effect.get(this.broadcast.connection.url);
			const connection = effect.get(this.broadcast.connection.status);
			const broadcast = effect.get(this.broadcast.status);

			if (!url) {
				container.textContent = "🔴\u00A0No URL";
			} else if (connection === "disconnected") {
				container.textContent = "🔴\u00A0Disconnected";
			} else if (connection === "connecting") {
				container.textContent = "🟡\u00A0Connecting...";
			} else if (broadcast === "offline") {
				container.textContent = "🔴\u00A0Offline";
			} else if (broadcast === "loading") {
				container.textContent = "🟡\u00A0Loading...";
			} else if (broadcast === "live") {
				container.textContent = "🟢\u00A0Live";
			} else if (connection === "connected") {
				container.textContent = "🟢\u00A0Connected";
			}
		});

		parent.appendChild(container);
		effect.cleanup(() => parent.removeChild(container));
	}

	#renderFullscreen(parent: HTMLDivElement, effect: Effect) {
		const button = DOM.create(
			"button",
			{
				type: "button",
				title: "Fullscreen",
			},
			"⛶",
		);

		button.addEventListener("click", () => {
			if (document.fullscreenElement) {
				document.exitFullscreen();
			} else {
				this.requestFullscreen();
			}
		});

		parent.appendChild(button);
		effect.cleanup(() => parent.removeChild(button));
	}
}

customElements.define("hang-watch", HangWatch);

declare global {
	interface HTMLElementTagNameMap {
		"hang-watch": HangWatch;
	}
}
