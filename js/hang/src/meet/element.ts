import { Path } from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import * as DOM from "@kixelated/signals/dom";
import { type Publish, Watch } from "..";
import { Connection } from "../connection";
import HangPublish from "../publish/element";
import { Room } from "./room";

const OBSERVED = ["url", "name"] as const;
type Observed = (typeof OBSERVED)[number];

export interface HangMeetSignals {
	url: Signal<URL | undefined>;
	name: Signal<Path.Valid | undefined>;
}

// NOTE: This element is more of an example of how to use the library.
// You likely want your own layout, rendering, controls, etc.
// This element instead creates a crude NxN grid of broadcasts.
export default class HangMeet extends HTMLElement {
	static observedAttributes = OBSERVED;

	signals: HangMeetSignals = {
		url: new Signal<URL | undefined>(undefined),
		name: new Signal<Path.Valid | undefined>(undefined),
	};

	active = new Signal<HangMeetInstance | undefined>(undefined);

	connectedCallback() {
		if (this.active.peek()) throw new Error("connectedCallback called twice");
		this.active.set(new HangMeetInstance(this));
	}

	disconnectedCallback() {
		if (!this.active.peek()) throw new Error("disconnectedCallback called without connectedCallback");
		this.active.set((prev) => {
			prev?.close();
			return undefined;
		});
	}

	attributeChangedCallback(name: Observed, _oldValue: string | null, newValue: string | null) {
		if (name === "url") {
			this.url = newValue ? new URL(newValue) : undefined;
		} else if (name === "name") {
			this.name = newValue ?? undefined;
		} else {
			const exhaustive: never = name;
			throw new Error(`Invalid attribute: ${exhaustive}`);
		}
	}

	get url(): URL | undefined {
		return this.signals.url.peek();
	}

	set url(url: URL | undefined) {
		this.signals.url.set(url);
	}

	get name(): string | undefined {
		return this.signals.name.peek()?.toString();
	}

	set name(name: string | undefined) {
		this.signals.name.set(name ? Path.from(name) : undefined);
	}
}

class HangMeetInstance {
	parent: HangMeet;

	connection: Connection;
	room: Room;

	#container: HTMLDivElement;

	// Save a reference to the <video> tag used to render the local broadcast.
	#locals = new Map<Path.Valid, { video: HTMLVideoElement; cleanup: () => void }>();

	// We have to save a reference to the Video/Audio renderers so we can close them.
	#remotes = new Map<
		string,
		{ canvas: HTMLCanvasElement; renderer: Watch.VideoRenderer; emitter: Watch.AudioEmitter }
	>();

	#signals = new Effect();

	constructor(parent: HangMeet) {
		this.parent = parent;

		this.connection = new Connection({ url: this.parent.signals.url });
		this.room = new Room(this.connection, { name: this.parent.signals.name });

		this.#container = DOM.create("div", {
			style: {
				display: "grid",
				gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
				gap: "10px",
				alignItems: "center",
			},
		});

		DOM.render(this.#signals, this.parent, this.#container);

		// A callback that is fired when one of our local broadcasts is added/removed.
		this.room.onLocal(this.#onLocal.bind(this));

		// A callback that is fired when a remote broadcast is added/removed.
		this.room.onRemote(this.#onRemote.bind(this));

		this.#signals.effect((effect) => {
			// This is kind of a hack to reload the effect when the DOM changes.
			const observer = new MutationObserver(() => effect.reload());
			observer.observe(this.parent, { childList: true });
			effect.cleanup(() => observer.disconnect());

			this.#run(effect);
		})
	}

	#run(effect: Effect) {
		// Find any nested `hang-publish` elements and mark them as local.
		for (const element of this.parent.querySelectorAll("hang-publish")) {
			if (!(element instanceof HangPublish)) {
				console.warn("hang-publish element not found; tree-shaking?");
				continue;
			}

			const publish = element as HangPublish;

			// Monitor the name of the publish element and update the room.
			effect.effect((effect) => {
				const active = effect.get(publish.active);
				if (!active) return;

				const name = effect.get(active.broadcast.name);
				if (!name) return;

				this.room.preview(name, active.broadcast);
				effect.cleanup(() => this.room.unpreview(name));
			});

			// Copy the connection URL to the publish element so they're the same.
			// TODO Reuse the connection instead of dialing a new one.
			effect.effect((effect) => {
				publish.url = effect.get(this.connection.url);
			});
		}
	}

	#onLocal(name: Path.Valid, broadcast?: Publish.Broadcast) {
		if (!broadcast) {
			const existing = this.#locals.get(name);
			if (!existing) return;

			this.#locals.delete(name);
			existing.cleanup();
			existing.video.remove();

			return;
		}

		const video = DOM.create("video", {
			style: {
				width: "100%",
				height: "100%",
				objectFit: "contain",
			},
			muted: true,
			playsInline: true,
			autoplay: true,
		});

		const cleanup = broadcast.video.source.subscribe((media) => {
			video.srcObject = media ? new MediaStream([media]) : null;
		});

		this.#locals.set(name, { video, cleanup });
		this.#container.appendChild(video);
	}

	#onRemote(name: Path.Valid, broadcast?: Watch.Broadcast) {
		if (!broadcast) {
			const existing = this.#remotes.get(name);
			if (!existing) return;

			this.#remotes.delete(name);

			existing.renderer.close();
			existing.emitter.close();
			existing.canvas.remove();

			return;
		}

		// We're reponsible for signalling that we want to download this broadcast.
		broadcast.enabled.set(true);

		// Create a canvas to render the video to.
		const canvas = DOM.create("canvas", {
			style: {
				width: "100%",
				height: "100%",
				objectFit: "contain",
			},
		});

		const renderer = new Watch.VideoRenderer(broadcast.video, { canvas });
		const emitter = new Watch.AudioEmitter(broadcast.audio);

		this.#remotes.set(name, { canvas, renderer, emitter });

		// Add the canvas to the DOM.
		this.#container.appendChild(canvas);
	}

	close() {
		this.#signals.close();
		this.room.close();
		this.connection.close();
	}
}

customElements.define("hang-meet", HangMeet);

declare global {
	interface HTMLElementTagNameMap {
		"hang-meet": HangMeet;
	}
}
