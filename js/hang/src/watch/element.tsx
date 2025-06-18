import { Root, Signal } from "@kixelated/signals";
import { Show } from "solid-js";
import { render } from "solid-js/web";
import { Connection } from "../connection";
import { AudioEmitter } from "./audio";
import { Broadcast } from "./broadcast";
import { Controls } from "./controls";
import { VideoRenderer } from "./video";
import solid from "@kixelated/signals/solid";

// An optional web component that wraps a <canvas>
export default class HangWatch extends HTMLElement {
	static observedAttributes = ["url", "paused", "volume", "muted", "controls"];

	#controls = new Signal(false);

	// You can construct these manually if you want to use the library without the web component.
	// However be warned that the API is still in flux and may change.
	connection: Connection;
	broadcast: Broadcast;
	video: VideoRenderer;
	audio: AudioEmitter;

	#signals = new Root();

	constructor() {
		super();

		const canvas = this.querySelector("canvas") as HTMLCanvasElement | undefined;

		this.connection = new Connection();
		this.broadcast = new Broadcast(this.connection, { enabled: true });
		this.video = new VideoRenderer(this.broadcast.video, { canvas });
		this.audio = new AudioEmitter(this.broadcast.audio);

		// Render the controls element.
		render(
			() => (
				<Show when={solid(this.#controls)}>
					<Controls broadcast={this.broadcast} video={this.video} audio={this.audio} root={this} />
				</Show>
			),
			this,
		);

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
	}

	attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
		if (oldValue === newValue) {
			return;
		}

		if (name === "url") {
			this.connection.url.set(newValue ? new URL(newValue) : undefined);
		} else if (name === "paused") {
			this.video.paused.set(newValue !== null);
		} else if (name === "volume") {
			const volume = newValue ? Number.parseFloat(newValue) : 0.5;
			this.audio.volume.set(volume);
		} else if (name === "muted") {
			this.audio.muted.set(newValue !== null);
		} else if (name === "controls") {
			this.#controls.set(newValue !== null);
		}
	}

	// TODO Do this on disconnectedCallback?
	close() {
		this.connection.close();
		this.broadcast.close();
		this.video.close();
		this.audio.close();
		this.#signals.close();
	}
}

customElements.define("hang-watch", HangWatch);

declare global {
	interface HTMLElementTagNameMap {
		"hang-watch": HangWatch;
	}
}
