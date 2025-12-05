import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import * as DOM from "@kixelated/signals/dom";
import type * as Time from "../time";
import * as Audio from "./audio";
import { Broadcast } from "./broadcast";
import * as Video from "./video";

const OBSERVED = ["url", "name", "path", "paused", "volume", "muted", "controls", "reload", "latency"] as const;
type Observed = (typeof OBSERVED)[number];

const cleanup = new FinalizationRegistry<Effect>((signals) => signals.close());

// An optional web component that wraps a <canvas>
export default class HangWatch extends HTMLElement {
	static observedAttributes = OBSERVED;

	// The connection to the moq-relay server.
	connection: Moq.Connection.Reload;

	// The broadcast being watched.
	broadcast: Broadcast;

	// Responsible for rendering the video.
	video: Video.Renderer;

	// Responsible for emitting the audio.
	audio: Audio.Emitter;

	// The URL of the moq-relay server
	url = new Signal<URL | undefined>(undefined);

	// The path of the broadcast relative to the URL (may be empty).
	path = new Signal<Moq.Path.Valid | undefined>(undefined);

	// Whether audio/video playback is paused.
	paused = new Signal(false);

	// The volume of the audio, between 0 and 1.
	volume = new Signal(0.5);

	// Whether the audio is muted.
	muted = new Signal(false);

	// Whether the controls are shown.
	controls = new Signal(false);

	// Don't automatically reload the broadcast.
	// TODO: Temporarily defaults to false because Cloudflare doesn't support it yet.
	reload = new Signal(false);

	// Delay playing audio and video for up to 100ms
	latency = new Signal(100 as Time.Milli);

	// Set when the element is connected to the DOM.
	#enabled = new Signal(false);

	// The canvas element to render the video to.
	#canvas = new Signal<HTMLCanvasElement | undefined>(undefined);

	#signals = new Effect();

	constructor() {
		super();

		// Close everything when this element is garbage collected.
		cleanup.register(this, this.#signals);

		this.connection = new Moq.Connection.Reload({
			url: this.url,
			enabled: true,
		});
		this.#signals.cleanup(() => this.connection.close());

		this.broadcast = new Broadcast({
			connection: this.connection.established,
			path: this.path,
			enabled: this.#enabled,
			reload: this.reload,
			audio: {
				latency: this.latency,
			},
			video: {
				latency: this.latency,
			},
		});
		this.#signals.cleanup(() => this.broadcast.close());

		this.video = new Video.Renderer(this.broadcast.video, { canvas: this.#canvas, paused: this.paused });
		this.#signals.cleanup(() => this.video.close());

		this.audio = new Audio.Emitter(this.broadcast.audio, {
			volume: this.volume,
			muted: this.muted,
			paused: this.paused,
		});
		this.#signals.cleanup(() => this.audio.close());

		// Watch to see if the canvas element is added or removed.
		const observer = new MutationObserver(() => {
			this.#canvas.set(this.querySelector("canvas") as HTMLCanvasElement | undefined);
		});
		observer.observe(this, { childList: true, subtree: true });
		this.#signals.cleanup(() => observer.disconnect());

		// Optionally update attributes to match the library state.
		// This is kind of dangerous because it can create loops.
		// NOTE: This only runs when the element is connected to the DOM, which is not obvious.
		// This is because there's no destructor for web components to clean up our effects.
		this.#signals.effect((effect) => {
			const url = effect.get(this.url);
			if (url) {
				this.setAttribute("url", url.toString());
			} else {
				this.removeAttribute("url");
			}
		});

		this.#signals.effect((effect) => {
			const broadcast = effect.get(this.path);
			if (broadcast) {
				this.setAttribute("path", broadcast.toString());
			} else {
				this.removeAttribute("path");
			}
		});

		this.#signals.effect((effect) => {
			const muted = effect.get(this.muted);
			if (muted) {
				this.setAttribute("muted", "");
			} else {
				this.removeAttribute("muted");
			}
		});

		this.#signals.effect((effect) => {
			const paused = effect.get(this.paused);
			if (paused) {
				this.setAttribute("paused", "true");
			} else {
				this.removeAttribute("paused");
			}
		});

		this.#signals.effect((effect) => {
			const volume = effect.get(this.volume);
			this.setAttribute("volume", volume.toString());
		});

		this.#signals.effect((effect) => {
			const controls = effect.get(this.controls);
			if (controls) {
				this.setAttribute("controls", "");
			} else {
				this.removeAttribute("controls");
			}
		});

		this.#signals.effect((effect) => {
			const latency = Math.floor(effect.get(this.latency));
			this.setAttribute("latency", latency.toString());
		});

		this.#signals.effect(this.#renderControls.bind(this));
	}

	// Annoyingly, we have to use these callbacks to figure out when the element is connected to the DOM.
	// This wouldn't be so bad if there was a destructor for web components to clean up our effects.
	connectedCallback() {
		this.#enabled.set(true);
		this.style.display = "block";
		this.style.position = "relative";
	}

	disconnectedCallback() {
		// Stop everything but don't actually cleanup just in case we get added back to the DOM.
		this.#enabled.set(false);
	}

	attributeChangedCallback(name: Observed, oldValue: string | null, newValue: string | null) {
		if (oldValue === newValue) {
			return;
		}

		if (name === "url") {
			this.url.set(newValue ? new URL(newValue) : undefined);
		} else if (name === "name" || name === "path") {
			// TODO remove backwards compatibility
			this.path.set(newValue ? Moq.Path.from(newValue) : undefined);
		} else if (name === "paused") {
			this.paused.set(newValue !== null);
		} else if (name === "volume") {
			const volume = newValue ? Number.parseFloat(newValue) : 0.5;
			this.volume.set(volume);
		} else if (name === "muted") {
			this.muted.set(newValue !== null);
		} else if (name === "controls") {
			this.controls.set(newValue !== null);
		} else if (name === "reload") {
			this.reload.set(newValue !== null);
		} else if (name === "latency") {
			this.latency.set((newValue ? Number.parseFloat(newValue) : 100) as Time.Milli);
		} else {
			const exhaustive: never = name;
			throw new Error(`Invalid attribute: ${exhaustive}`);
		}
	}

	#renderControls(effect: Effect) {
		const controls = DOM.create("div", {
			style: {
				display: "flex",
				justifyContent: "space-around",
				gap: "8px",
				alignContent: "center",
			},
		});

		DOM.render(effect, this, controls);

		effect.effect((effect) => {
			const show = effect.get(this.controls);
			if (!show) return;

			this.#renderPause(controls, effect);
			this.#renderVolume(controls, effect);
			this.#renderStatus(controls, effect);
			this.#renderFullscreen(controls, effect);
			this.#renderBuffering(effect);
			this.#renderLatency(effect);
		});
	}

	#renderPause(parent: HTMLDivElement, effect: Effect) {
		const button = DOM.create("button", {
			type: "button",
			title: "Pause",
		});

		effect.event(button, "click", (e) => {
			e.preventDefault();
			this.video.paused.update((prev) => !prev);
		});

		effect.effect((effect) => {
			const paused = effect.get(this.video.paused);
			button.textContent = paused ? "▶️" : "⏸️";
		});

		DOM.render(effect, parent, button);
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

		effect.event(muteButton, "click", () => {
			this.audio.muted.update((p) => !p);
		});

		const volumeSlider = DOM.create("input", {
			type: "range",
			min: "0",
			max: "100",
		});

		effect.event(volumeSlider, "input", (e) => {
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

		DOM.render(effect, container, muteButton);
		DOM.render(effect, container, volumeSlider);
		DOM.render(effect, container, volumeLabel);
		DOM.render(effect, parent, container);
	}

	#renderStatus(parent: HTMLDivElement, effect: Effect) {
		const container = DOM.create("div");

		effect.effect((effect) => {
			const url = effect.get(this.connection.url);
			const connection = effect.get(this.connection.status);
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

		DOM.render(effect, parent, container);
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

		effect.event(button, "click", () => {
			if (document.fullscreenElement) {
				document.exitFullscreen();
			} else {
				this.requestFullscreen();
			}
		});

		DOM.render(effect, parent, button);
	}

	#renderLatency(effect: Effect) {
		const container = DOM.create("div", {
			style: {
				display: "flex",
				alignItems: "center",
				gap: "8px",
				padding: "8px 12px",
				background: "transparent",
				borderRadius: "8px",
				margin: "8px 0",
			},
		});

		const label = DOM.create("span", {
			style: {
				fontSize: "20px",
				fontWeight: "500",
				color: "#fff",
				whiteSpace: "nowrap",
			},
			textContent: "Latency:",
		});

		const slider = DOM.create("input", {
			type: "range",
			style: {
				flex: "1",
				height: "6px",
				borderRadius: "3px",
				background: "transparent",
				cursor: "pointer",
			},
			min: "0",
			max: "20000",
			step: "100",
		});

		const valueDisplay = DOM.create("span", {
			style: {
				fontSize: "20px",
				minWidth: "60px",
				textAlign: "right",
				color: "#fff",
			},
		});

		effect.event(slider, "input", (e) => {
			const target = e.currentTarget as HTMLInputElement;
			const latency = parseFloat(target.value);
			this.latency.set(latency as Time.Milli);
		});

		effect.effect((innerEffect) => {
			const latency = innerEffect.get(this.latency);

			if (document.activeElement !== slider) {
				slider.value = latency.toString();
			}

			valueDisplay.textContent = `${Math.round(latency)}ms`;
		});

		DOM.render(effect, container, label);
		DOM.render(effect, container, slider);
		DOM.render(effect, container, valueDisplay);
		DOM.render(effect, this, container);
	}

	#renderBuffering(effect: Effect) {
		const container = this.querySelector("#watch-container") as HTMLElement;
		if (!container) return;

		if (!document.getElementById("buffer-spinner-animation")) {
			const style = document.createElement("style");
			style.id = "buffer-spinner-animation";
			style.textContent = `
				@keyframes buffer-spin {
					0% { transform: rotate(0deg); }
					100% { transform: rotate(360deg); }
				}
			`;
			document.head.appendChild(style);
		}

		const overlay = DOM.create("div", {
			style: {
				position: "absolute",
				display: "none",
				justifyContent: "center",
				alignItems: "center",
				width: "100%",
				height: "100%",
				top: "0",
				left: "0",
				zIndex: "1",
				backgroundColor: "rgba(0, 0, 0, 0.4)",
				backdropFilter: "blur(2px)",
				pointerEvents: "none",
			},
		});

		const spinner = DOM.create("div", {
			style: {
				width: "40px",
				height: "40px",
				border: "4px solid rgba(255, 255, 255, 0.2)",
				borderTop: "4px solid #fff",
				borderRadius: "50%",
				animation: "buffer-spin 1s linear infinite",
			},
		});

		overlay.appendChild(spinner);
		container.appendChild(overlay);

		effect.effect((effect) => {
			const syncStatus = effect.get(this.video.source.syncStatus);
			const bufferStatus = effect.get(this.video.source.bufferStatus);
			const shouldShow = syncStatus.state === "wait" || bufferStatus.state === "empty";

			if (shouldShow) {
				overlay.style.display = "flex";
			} else {
				overlay.style.display = "none";
			}
		});

		effect.cleanup(() => {
			if (overlay.parentNode) {
				overlay.parentNode.removeChild(overlay);
			}
		});
	}
}

customElements.define("hang-watch", HangWatch);

declare global {
	interface HTMLElementTagNameMap {
		"hang-watch": HangWatch;
	}
}
