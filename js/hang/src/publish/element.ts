import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import * as DOM from "@kixelated/signals/dom";
import { Connection } from "../connection";
import { Broadcast } from "./broadcast";
import * as Source from "./source";

const OBSERVED = ["url", "name", "device", "audio", "video", "controls", "captions"] as const;
type Observed = (typeof OBSERVED)[number];

type SourceType = "camera" | "screen";

export default class HangPublish extends HTMLElement {
	static observedAttributes = OBSERVED;

	#controls = new Signal(false);

	connection: Connection;
	broadcast: Broadcast;

	#source = new Signal<SourceType | undefined>(undefined);
	#video?: Source.Camera | Source.Screen;
	#audio?: Source.Microphone | Source.Screen;

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

	attributeChangedCallback(name: Observed, _oldValue: string | null, newValue: string | null) {
		if (name === "url") {
			this.url = newValue ? new URL(newValue) : undefined;
		} else if (name === "name") {
			this.name = newValue ?? undefined;
		} else if (name === "device") {
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

	get source(): SourceType | undefined {
		return this.#source.peek();
	}

	set source(source: SourceType | undefined) {
		this.#video?.close();
		this.#audio?.close();

		if (source === "camera") {
			this.#video = new Source.Camera({ enabled: this.broadcast.video.enabled.peek() });
			this.#video.signals.proxy(this.#video.stream, this.broadcast.video.source);

			this.#audio = new Source.Microphone({ enabled: this.broadcast.audio.enabled.peek() });
			this.#audio.signals.proxy(this.#audio.stream, this.broadcast.audio.source);
		} else if (source === "screen") {
			const screen = new Source.Screen({ enabled: this.broadcast.video.enabled.peek() || this.broadcast.audio.enabled.peek() });
			screen.signals.effect((effect) => {
				const stream = effect.get(screen.stream);
				if (!stream) return;

				effect.set(this.broadcast.video.source, stream.video);
				effect.set(this.broadcast.audio.source, stream.audio);
			});

			this.#audio = screen;
			this.#video = screen;
		} else {
			this.#video = undefined;
			this.#audio = undefined;
		}

		this.#source.set(source);
	}

	get audio(): boolean {
		return this.broadcast.audio.enabled.peek();
	}

	set audio(audio: boolean) {
		this.broadcast.audio.enabled.set(audio);

		if (this.#audio instanceof Source.Screen) {
			// Enable the screenshare capture if either audio or video are enabled.
			this.#audio.enabled.set(audio || !!this.#video?.enabled.peek());
		} else {
			this.#audio?.enabled.set(audio);
		}
	}

	get video(): boolean {
		return this.broadcast.video.enabled.peek();
	}

	set video(video: boolean) {
		this.broadcast.video.enabled.set(video);

		if (this.#video instanceof Source.Screen) {
			// Only disable the screenshare capture if both audio and video are disabled.
			this.#video.enabled.set(video || (!!this.#audio?.enabled.peek()));
		} else {
			this.#video?.enabled.set(video);
		}
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
			"Device:",
		);

		const createButton = (source: SourceType | undefined, title: string, emoji: string) => {
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
				this.source = source;
			});

			effect.effect((effect) => {
				const selected = effect.get(this.#source);
				button.style.opacity = selected === source ? "1" : "0.5";
			});

			container.appendChild(button);
			effect.cleanup(() => container.removeChild(button));
		};

		createButton("camera", "Camera", "📷");
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
