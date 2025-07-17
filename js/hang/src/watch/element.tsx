import { Root, Signal } from "@kixelated/signals";
import solid from "@kixelated/signals/solid";
import { type JSX, Match, Show, Switch } from "solid-js";
import { render } from "solid-js/web";
import { Connection } from "../connection";
import { AudioEmitter } from "./audio";
import { Broadcast } from "./broadcast";
import { VideoRenderer } from "./video";

const OBSERVED = ["url", "name", "paused", "volume", "muted", "controls"] as const;
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

	#signals = new Root();

	constructor() {
		super();

		const canvas = this.querySelector("canvas") as HTMLCanvasElement | undefined;

		this.connection = new Connection();
		this.broadcast = new Broadcast(this.connection, { enabled: true });
		this.video = new VideoRenderer(this.broadcast.video, { canvas });
		this.audio = new AudioEmitter(this.broadcast.audio);

		const controls = solid(this.#controls);

		// Render the controls element.
		render(
			() => (
				<Show when={controls()}>
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
			const broadcast = effect.get(this.broadcast.name);
			if (broadcast) {
				this.setAttribute("broadcast", broadcast);
			} else {
				this.removeAttribute("broadcast");
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
		return this.broadcast.name.peek();
	}

	set name(name: string | undefined) {
		this.broadcast.name.set(name);
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

// A simple set of controls mostly for the demo.
function Controls(props: {
	broadcast: Broadcast;
	video: VideoRenderer;
	audio: AudioEmitter;
	root: HTMLElement;
}): JSX.Element {
	const root = props.root;

	return (
		<div
			style={{
				display: "flex",
				"justify-content": "space-around",
				margin: "8px 0",
				gap: "8px",
				"align-content": "center",
			}}
		>
			<Pause video={props.video} />
			<Volume audio={props.audio} />
			<Status broadcast={props.broadcast} />
			<Fullscreen root={root} />
		</div>
	);
}

function Pause(props: { video: VideoRenderer }): JSX.Element {
	const paused = solid(props.video.paused);
	const togglePause = (e: MouseEvent) => {
		e.preventDefault();
		props.video.paused.set((prev) => !prev);
	};

	return (
		<button title="Pause" type="button" onClick={togglePause}>
			<Show when={paused()} fallback={<>⏸️</>}>
				▶️
			</Show>
		</button>
	);
}

function Volume(props: { audio: AudioEmitter }): JSX.Element {
	const volume = solid(props.audio.volume);

	const changeVolume = (str: string) => {
		const v = Number.parseFloat(str) / 100;
		props.audio.volume.set(v);
	};

	const toggleMute = () => {
		props.audio.muted.set((p) => !p);
	};
	const rounded = () => Math.round(volume() * 100);

	return (
		<div style={{ display: "flex", "align-items": "center", gap: "0.25rem" }}>
			<button title="Mute" type="button" onClick={toggleMute}>
				<Show when={volume() === 0} fallback={<>🔊</>}>
					🔇
				</Show>
			</button>
			<input
				type="range"
				min="0"
				max="100"
				value={volume() * 100}
				onInput={(e) => changeVolume(e.currentTarget.value)}
			/>
			<span style={{ display: "inline-block", width: "2em", "text-align": "right" }}>{rounded()}%</span>
		</div>
	);
}

function Status(props: { broadcast: Broadcast }): JSX.Element {
	const url = solid(props.broadcast.connection.url);
	const connection = solid(props.broadcast.connection.status);
	const broadcast = solid(props.broadcast.status);

	return (
		<div>
			<Switch>
				<Match when={!url()}>🔴&nbsp;No URL</Match>
				<Match when={connection() === "disconnected"}>🔴&nbsp;Disconnected</Match>
				<Match when={connection() === "connecting"}>🟡&nbsp;Connecting...</Match>
				<Match when={broadcast() === "offline"}>🔴&nbsp;Offline</Match>
				<Match when={broadcast() === "loading"}>🟡&nbsp;Loading...</Match>
				<Match when={broadcast() === "live"}>🟢&nbsp;Live</Match>
				<Match when={connection() === "connected"}>🟢&nbsp;Connected</Match>
			</Switch>
		</div>
	);
}

function Fullscreen(props: { root: HTMLElement }): JSX.Element {
	const toggleFullscreen = () => {
		if (document.fullscreenElement) {
			document.exitFullscreen();
		} else {
			props.root.requestFullscreen();
		}
	};
	return (
		<button title="Fullscreen" type="button" onClick={toggleFullscreen}>
			⛶
		</button>
	);
}
