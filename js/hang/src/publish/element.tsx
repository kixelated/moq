import { Root, Signal } from "@kixelated/signals";
import { Show } from "solid-js";
import { render } from "solid-js/web";
import { Connection } from "../connection";
import { Broadcast, Device } from "./broadcast";
import { Controls } from "./controls";

export default class HangPublish extends HTMLElement {
	static observedAttributes = ["url", "device", "audio", "video", "controls"];

	#controls = new Signal(false);

	connection: Connection;
	broadcast: Broadcast;

	#signals = new Root();

	constructor() {
		super();

		const preview = this.querySelector("video") as HTMLVideoElement | undefined;

		this.connection = new Connection();
		this.broadcast = new Broadcast(this.connection);

		// Only publish when we have media available.
		this.#signals.effect((effect) => {
			const audio = effect.get(this.broadcast.audio.media);
			const video = effect.get(this.broadcast.video.media);
			this.broadcast.enabled.set(!!audio || !!video);
		});

		this.#signals.effect((effect) => {
			const media = effect.get(this.broadcast.video.media);
			if (!media || !preview) return;

			preview.srcObject = new MediaStream([media]);
			effect.cleanup(() => {
				preview.srcObject = null;
			});
		});

		// Render the controls element.
		render(
			() => (
				<Show when={this.#controls.solid()}>
					<Controls broadcast={this.broadcast} />
				</Show>
			),
			this,
		);
	}

	attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null) {
		if (name === "url") {
			this.connection.url.set(newValue ? new URL(newValue) : undefined);
		} else if (name === "device") {
			this.broadcast.device.set(newValue as Device);
		} else if (name === "audio") {
			this.broadcast.audio.enabled.set(newValue !== null);
		} else if (name === "video") {
			this.broadcast.video.enabled.set(newValue !== null);
		} else if (name === "controls") {
			this.#controls.set(newValue !== null);
		}
	}
}

customElements.define("hang-publish", HangPublish);

declare global {
	interface HTMLElementTagNameMap {
		"hang-publish": HangPublish;
	}
}
