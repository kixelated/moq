import * as Moq from "@moq/lite";
import { Effect, Signal } from "@moq/signals";

const OBSERVED = ["url", "room", "name"] as const;
type Observed = (typeof OBSERVED)[number];

// Close everything when this element is garbage collected.
// This is primarily to avoid a console.warn that we didn't close() before GC.
// There's no destructor for web components so this is the best we can do.
const cleanup = new FinalizationRegistry<Effect>((signals) => signals.close());

export default class HangLive extends HTMLElement {
	static observedAttributes = OBSERVED;

	// The connection to the moq-relay server.
	connection: Moq.Connection.Reload;

	// The URL of the moq-relay server
	url = new Signal<URL | undefined>(undefined);

	// The room name
	room = new Signal<string | undefined>(undefined);

	// The participant name
	name = new Signal<string | undefined>(undefined);

	// Set when the element is connected to the DOM.
	#enabled = new Signal(false);

	// The base path for this participant's broadcasts
	#basePath = new Signal<Moq.Path.Valid | undefined>(undefined);

	// Camera broadcast path
	cameraPath = new Signal<Moq.Path.Valid | undefined>(undefined);

	// Screen share broadcast path
	screenPath = new Signal<Moq.Path.Valid | undefined>(undefined);

	// Expose the Effect class, so users can easily create effects scoped to this element.
	signals = new Effect();

	constructor() {
		super();

		cleanup.register(this, this.signals);

		this.connection = new Moq.Connection.Reload({
			url: this.url,
			enabled: this.#enabled,
		});
		this.signals.cleanup(() => this.connection.close());

		// Compute the base path from room and name
		this.signals.effect((effect) => {
			const room = effect.get(this.room);
			const name = effect.get(this.name);

			if (room && name) {
				this.#basePath.set(Moq.Path.from(room, name));
			} else {
				this.#basePath.set(undefined);
			}
		});

		// Compute camera and screen paths from base path
		this.signals.effect((effect) => {
			const basePath = effect.get(this.#basePath);

			if (basePath) {
				this.cameraPath.set(Moq.Path.from(basePath, "camera"));
				this.screenPath.set(Moq.Path.from(basePath, "screen"));
			} else {
				this.cameraPath.set(undefined);
				this.screenPath.set(undefined);
			}
		});

		// Optionally update attributes to match the library state.
		// This is kind of dangerous because it can create loops.
		// NOTE: This only runs when the element is connected to the DOM, which is not obvious.
		// This is because there's no destructor for web components to clean up our effects.
		this.signals.effect((effect) => {
			const url = effect.get(this.url);
			if (url) {
				this.setAttribute("url", url.toString());
			} else {
				this.removeAttribute("url");
			}
		});

		this.signals.effect((effect) => {
			const room = effect.get(this.room);
			if (room) {
				this.setAttribute("room", room);
			} else {
				this.removeAttribute("room");
			}
		});

		this.signals.effect((effect) => {
			const name = effect.get(this.name);
			if (name) {
				this.setAttribute("name", name);
			} else {
				this.removeAttribute("name");
			}
		});
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
		} else if (name === "room") {
			this.room.set(newValue ?? undefined);
		} else if (name === "name") {
			this.name.set(newValue ?? undefined);
		} else {
			const exhaustive: never = name;
			throw new Error(`Invalid attribute: ${exhaustive}`);
		}
	}
}

customElements.define("hang-live", HangLive);

declare global {
	interface HTMLElementTagNameMap {
		"hang-live": HangLive;
	}
}
