import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import * as DOM from "@kixelated/signals/dom";
import type * as Time from "../time";
import * as Audio from "./audio";
import { Broadcast } from "./broadcast";
import * as Video from "./video";

const OBSERVED = ["url", "name", "path", "paused", "volume", "muted", "controls", "reload", "latency"] as const;
type Observed = (typeof OBSERVED)[number];

export interface HangWatchSignals {
	url: Signal<URL | undefined>;
	path: Signal<Moq.Path.Valid | undefined>;
	paused: Signal<boolean>;
	volume: Signal<number>;
	muted: Signal<boolean>;
	controls: Signal<boolean>;
	reload: Signal<boolean>;
	latency: Signal<Time.Milli>;
}

// An optional web component that wraps a <canvas>
export default class HangWatch extends HTMLElement {
	static observedAttributes = OBSERVED;

	// We expose this publically so you can get access to the reactive signals.
	// ex. watch.signals.paused.subscribe((paused) => { ... });
	signals: HangWatchSignals = {
		// The URL of the moq-relay server
		url: new Signal<URL | undefined>(undefined),

		// The path of the broadcast relative to the URL (may be empty).
		path: new Signal<Moq.Path.Valid | undefined>(undefined),

		// Whether audio/video playback is paused.
		paused: new Signal(false),

		// The volume of the audio, between 0 and 1.
		volume: new Signal(0.5),

		// Whether the audio is muted.
		muted: new Signal(false),

		// Whether the controls are shown.
		controls: new Signal(false),

		// Don't automatically reload the broadcast.
		// TODO: Temporarily defaults to false because Cloudflare doesn't support it yet.
		reload: new Signal(false),

		// Delay playing audio and video for up to 100ms
		latency: new Signal(100 as Time.Milli),
	};

	// An instance of HangWatchInstance once its inserted into the DOM.
	active = new Signal<HangWatchInstance | undefined>(undefined);

	// Annoyingly, we have to use these callbacks to figure out when the element is connected to the DOM.
	// This wouldn't be so bad if there was a destructor for web components to clean up our effects.
	connectedCallback() {
		this.active.set(new HangWatchInstance(this));
	}

	disconnectedCallback() {
		this.active.update((prev) => {
			prev?.close();
			return undefined;
		});
	}

	attributeChangedCallback(name: Observed, oldValue: string | null, newValue: string | null) {
		if (oldValue === newValue) {
			return;
		}

		if (name === "url") {
			this.url = newValue ? new URL(newValue) : undefined;
		} else if (name === "name" || name === "path") {
			// TODO remove backwards compatibility
			this.path = newValue ?? undefined;
		} else if (name === "paused") {
			this.paused = newValue !== null;
		} else if (name === "volume") {
			const volume = newValue ? Number.parseFloat(newValue) : 0.5;
			this.volume = volume;
		} else if (name === "muted") {
			this.muted = newValue !== null;
		} else if (name === "controls") {
			this.controls = newValue !== null;
		} else if (name === "reload") {
			this.reload = newValue !== null;
		} else if (name === "latency") {
			this.latency = newValue ? Number.parseFloat(newValue) : 100;
		} else {
			const exhaustive: never = name;
			throw new Error(`Invalid attribute: ${exhaustive}`);
		}
	}

	// Make corresponding properties for the element, more type-safe than using attributes.
	get url(): URL | undefined {
		return this.signals.url.peek();
	}

	set url(url: URL | undefined) {
		this.signals.url.set(url);
	}

	// TODO remove backwards compatibility
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

	get paused(): boolean {
		return this.signals.paused.peek();
	}

	set paused(paused: boolean) {
		this.signals.paused.set(paused);
	}

	get volume(): number {
		return this.signals.volume.peek();
	}

	set volume(volume: number) {
		this.signals.volume.set(volume);
	}

	get muted(): boolean {
		return this.signals.muted.peek();
	}

	set muted(muted: boolean) {
		this.signals.muted.set(muted);
	}

	get controls(): boolean {
		return this.signals.controls.peek();
	}

	set controls(controls: boolean) {
		this.signals.controls.set(controls);
	}

	get reload(): boolean {
		return this.signals.reload.peek();
	}

	set reload(reload: boolean) {
		this.signals.reload.set(reload);
	}

	get latency(): number {
		return this.signals.latency.peek();
	}

	set latency(ms: number) {
		this.signals.latency.set(ms as Time.Milli);
	}
}

// An instance of HangWatch once its inserted into the DOM.
// We do this otherwise every variable could be undefined; which is annoying in Typescript.
export class HangWatchInstance {
	parent: HangWatch;

	// You can construct these manually if you want to use the library without the web component.
	// However be warned that the API is still in flux and may change.
	connection: Moq.Connection.Reload;
	broadcast: Broadcast;
	video: Video.Renderer;
	audio: Audio.Emitter;
	#signals: Effect;

	constructor(parent: HangWatch) {
		this.parent = parent;
		this.connection = new Moq.Connection.Reload({
			url: this.parent.signals.url,
			enabled: true,
		});

		this.broadcast = new Broadcast({
			connection: this.connection.established,
			path: this.parent.signals.path,
			enabled: true,
			reload: this.parent.signals.reload,
			audio: {
				latency: this.parent.signals.latency,
			},
			video: {
				latency: this.parent.signals.latency,
			},
		});

		this.#signals = new Effect();

		// Watch to see if the canvas element is added or removed.
		const canvas = new Signal(this.parent.querySelector("canvas") as HTMLCanvasElement | undefined);
		const observer = new MutationObserver(() => {
			canvas.set(this.parent.querySelector("canvas") as HTMLCanvasElement | undefined);
		});
		observer.observe(this.parent, { childList: true, subtree: true });
		this.#signals.cleanup(() => observer.disconnect());

		this.video = new Video.Renderer(this.broadcast.video, { canvas, paused: this.parent.signals.paused });
		this.audio = new Audio.Emitter(this.broadcast.audio, {
			volume: this.parent.signals.volume,
			muted: this.parent.signals.muted,
			paused: this.parent.signals.paused,
		});

		// Optionally update attributes to match the library state.
		// This is kind of dangerous because it can create loops.
		// NOTE: This only runs when the element is connected to the DOM, which is not obvious.
		// This is because there's no destructor for web components to clean up our effects.
		this.#signals.effect((effect) => {
			const url = effect.get(this.parent.signals.url);
			if (url) {
				this.parent.setAttribute("url", url.toString());
			} else {
				this.parent.removeAttribute("url");
			}
		});

		this.#signals.effect((effect) => {
			const broadcast = effect.get(this.parent.signals.path);
			if (broadcast) {
				this.parent.setAttribute("path", broadcast.toString());
			} else {
				this.parent.removeAttribute("path");
			}
		});

		this.#signals.effect((effect) => {
			const muted = effect.get(this.parent.signals.muted);
			if (muted) {
				this.parent.setAttribute("muted", "");
			} else {
				this.parent.removeAttribute("muted");
			}
		});

		this.#signals.effect((effect) => {
			const paused = effect.get(this.parent.signals.paused);
			if (paused) {
				this.parent.setAttribute("paused", "true");
			} else {
				this.parent.removeAttribute("paused");
			}
		});

		this.#signals.effect((effect) => {
			const volume = effect.get(this.parent.signals.volume);
			this.parent.setAttribute("volume", volume.toString());
		});

		this.#signals.effect((effect) => {
			const controls = effect.get(this.parent.signals.controls);
			if (controls) {
				this.parent.setAttribute("controls", "");
			} else {
				this.parent.removeAttribute("controls");
			}
		});

		this.#signals.effect((effect) => {
			const latency = Math.floor(effect.get(this.parent.signals.latency));
			this.parent.setAttribute("latency", latency.toString());
		});

		this.#signals.effect(this.#renderControls.bind(this));
	}

	close() {
		this.connection.close();
		this.broadcast.close();
		this.video.close();
		this.audio.close();
		this.#signals.close();
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

		DOM.render(effect, this.parent, controls);

		effect.effect((effect) => {
			const show = effect.get(this.parent.signals.controls);
			if (!show) return;

			this.#renderPause(controls, effect);
			this.#renderVolume(controls, effect);
			this.#renderStatus(controls, effect);
			this.#renderFullscreen(controls, effect);
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
				this.parent.requestFullscreen();
			}
		});

		DOM.render(effect, parent, button);
	}
}

customElements.define("hang-watch", HangWatch);

declare global {
	interface HTMLElementTagNameMap {
		"hang-watch": HangWatch;
	}
}
