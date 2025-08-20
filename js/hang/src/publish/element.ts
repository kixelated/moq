import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import * as DOM from "@kixelated/signals/dom";
import { Connection } from "../connection";
import { Broadcast, type Device } from "./broadcast";

const OBSERVED = ["url", "name", "device", "audio", "video", "controls", "transcribe", "captions"] as const;
type Observed = (typeof OBSERVED)[number];

export default class HangPublish extends HTMLElement {
	static observedAttributes = OBSERVED;

	#controls = new Signal(false);
	#captions = new Signal(false);

	connection: Connection;
	broadcast: Broadcast;

	#signals = new Effect();

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

		this.#renderControls();
		this.#renderCaptions();
	}

	attributeChangedCallback(name: Observed, _oldValue: string | null, newValue: string | null) {
		if (name === "url") {
			this.url = newValue ? new URL(newValue) : undefined;
		} else if (name === "name") {
			this.name = newValue ?? undefined;
		} else if (name === "device") {
			if (newValue === "camera" || newValue === "screen" || newValue === null) {
				this.device = newValue ?? undefined;
			} else {
				throw new Error(`Invalid device: ${newValue}`);
			}
		} else if (name === "audio") {
			this.audio = newValue !== null;
		} else if (name === "video") {
			this.video = newValue !== null;
		} else if (name === "controls") {
			this.controls = newValue !== null;
		} else if (name === "transcribe") {
			this.transcribe = newValue !== null;
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

	get device(): Device | undefined {
		return this.broadcast.device.peek();
	}

	set device(device: Device | undefined) {
		this.broadcast.device.set(device);
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

	get transcribe(): boolean {
		return this.broadcast.audio.captions.enabled.peek();
	}

	set transcribe(transcribe: boolean) {
		this.broadcast.audio.captions.enabled.set(transcribe);

		if (!transcribe && this.#captions.peek()) {
			// Disable captions if transcribe is disabled.
			this.#captions.set(false);
		}
	}

	get captions(): boolean {
		return this.#captions.peek();
	}

	set captions(captions: boolean) {
		this.#captions.set(captions);
		if (captions) {
			// Enable transcribe if captions are enabled.
			this.broadcast.audio.captions.enabled.set(true);
		}
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
			const show = effect.get(this.#captions);
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
				const speaking = effect.get(this.broadcast.audio.captions.speaking);

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
			"Device:",
		);

		const createButton = (device: Device | undefined, title: string, emoji: string) => {
			const button = DOM.create(
				"button",
				{
					type: "button",
					title,
					style: { cursor: "pointer" },
				},
				emoji,
			);

			button.addEventListener("click", () => {
				this.broadcast.device.set(device);
			});

			effect.effect((effect) => {
				const selected = effect.get(this.broadcast.device);
				button.style.opacity = selected === device ? "1" : "0.5";
			});

			container.appendChild(button);
			effect.cleanup(() => container.removeChild(button));
		};

		createButton("camera", "Camera", "🎥");
		createButton("screen", "Screen", "🖥️");
		createButton(undefined, "Nothing", "🚫");

		parent.appendChild(container);
		effect.cleanup(() => parent.removeChild(container));
	}

	#renderStatus(parent: HTMLDivElement, effect: Effect) {
		const container = DOM.create("div");

		effect.effect((effect) => {
			const url = effect.get(this.broadcast.connection.url);
			const status = effect.get(this.broadcast.connection.status);
			const audio = effect.get(this.broadcast.audio.catalog);
			const video = effect.get(this.broadcast.video.catalog);

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
			} else if (status === "connected") {
				container.textContent = "🟢\u00A0Connected";
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
