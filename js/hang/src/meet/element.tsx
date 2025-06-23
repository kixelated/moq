import { Root } from "@kixelated/signals";
import { Publish, Watch } from "..";
import { Connection } from "../connection";
import { Room } from "./room";

import HangPublish from "../publish/element";

// NOTE: This element is more of an example of how to use the library.
// You likely want your own layout, rendering, controls, etc.
// This element instead creates a crude NxN grid of broadcasts.
export default class HangMeet extends HTMLElement {
	static observedAttributes = ["url", "path"];

	connection: Connection;
	room: Room;

	#container: HTMLDivElement;

	// Save a reference to the <video> tag used to render the local broadcast.
	#locals = new Map<string, { video: HTMLVideoElement; cleanup: () => void }>();

	// We have to save a reference to the Video/Audio renderers so we can close them.
	#remotes = new Map<
		string,
		{ canvas: HTMLCanvasElement; renderer: Watch.VideoRenderer; emitter: Watch.AudioEmitter }
	>();

	#signals = new Root();

	constructor() {
		super();

		this.connection = new Connection();
		this.room = new Room(this.connection);

		this.#container = document.createElement("div");
		this.#container.style.display = "grid";
		this.#container.style.gridTemplateColumns = "repeat(auto-fit, minmax(200px, 1fr))";
		this.#container.style.gap = "10px";
		this.#container.style.alignItems = "center";
		this.appendChild(this.#container);

		// A callback that is fired when one of our local broadcasts is added/removed.
		this.room.onLocal(this.#onLocal.bind(this));

		// A callback that is fired when a remote broadcast is added/removed.
		this.room.onRemote(this.#onRemote.bind(this));
	}

	connectedCallback() {
		// Find any nested `hang-publish` elements and mark them as local.
		for (const element of this.querySelectorAll("hang-publish")) {
			if (!(element instanceof HangPublish)) {
				console.warn("hang-publish element not found; tree-shaking?");
				continue;
			}

			const publish = element as HangPublish;

			// Monitor the path of the publish element and update the room.
			this.#signals.effect((effect) => {
				const path = effect.get(publish.broadcast.path);
				if (!path) return;

				this.room.preview(path, publish.broadcast);
				effect.cleanup(() => this.room.unpreview(path));
			});

			// Copy the connection URL to the publish element so they're the same.
			this.#signals.effect((effect) => {
				const url = effect.get(this.connection.url);

				publish.connection.url.set(url);
				effect.cleanup(() => publish.connection.url.set(undefined));
			});
		}
	}

	disconnectedCallback() {
		this.#signals.close();
	}

	#onLocal(path: string, broadcast?: Publish.Broadcast) {
		if (!broadcast) {
			const existing = this.#locals.get(path);
			if (!existing) return;

			this.#locals.delete(path);
			existing.cleanup();
			existing.video.remove();

			return;
		}

		const video = document.createElement("video");
		video.style.width = "100%";
		video.style.height = "100%";
		video.style.objectFit = "contain";
		video.muted = true;
		video.playsInline = true;
		video.autoplay = true;

		const cleanup = broadcast.video.media.subscribe((media) => {
			video.srcObject = media ? new MediaStream([media]) : null;
		});

		this.#locals.set(path, { video, cleanup });
		this.#container.appendChild(video);
	}

	#onRemote(path: string, broadcast?: Watch.Broadcast) {
		if (!broadcast) {
			const existing = this.#remotes.get(path);
			if (!existing) return;

			this.#remotes.delete(path);

			existing.renderer.close();
			existing.emitter.close();
			existing.canvas.remove();

			return;
		}

		// We're reponsible for signalling that we want to download this broadcast.
		broadcast.enabled.set(true);

		// Create a canvas to render the video to.
		const canvas = document.createElement("canvas");
		canvas.style.width = "100%";
		canvas.style.height = "100%";
		canvas.style.objectFit = "contain";

		const renderer = new Watch.VideoRenderer(broadcast.video, { canvas });
		const emitter = new Watch.AudioEmitter(broadcast.audio);

		this.#remotes.set(path, { canvas, renderer, emitter });

		// Add the canvas to the DOM.
		this.#container.appendChild(canvas);
	}

	attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null) {
		if (name === "url") {
			this.connection.url.set(newValue ? new URL(newValue) : undefined);
		} else if (name === "path") {
			this.room.path.set(newValue ?? "");
		}
	}
}

customElements.define("hang-meet", HangMeet);

declare global {
	interface HTMLElementTagNameMap {
		"hang-meet": HangMeet;
	}
}
