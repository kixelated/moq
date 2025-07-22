import * as Moq from "@kixelated/moq";
import { Root, Signal } from "@kixelated/signals";
import solid from "@kixelated/signals/solid";
import { Show } from "solid-js";
import { render } from "solid-js/web";
import { Connection } from "../connection";
import { Broadcast, type Device } from "./broadcast";

const OBSERVED = ["url", "name", "device", "audio", "video", "controls"] as const;
type Observed = (typeof OBSERVED)[number];

export default class HangPublish extends HTMLElement {
	static observedAttributes = OBSERVED;

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
				<Show when={solid(this.#controls)}>
					<Controls broadcast={this.broadcast} />
				</Show>
			),
			this,
		);
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
}

customElements.define("hang-publish", HangPublish);

declare global {
	interface HTMLElementTagNameMap {
		"hang-publish": HangPublish;
	}
}

import { createSelector, Match, Switch } from "solid-js";
import type { JSX } from "solid-js/jsx-runtime";

function Controls(props: { broadcast: Broadcast }): JSX.Element {
	return (
		<div
			style={{
				display: "flex",
				"justify-content": "space-around",
				gap: "16px",
				margin: "8px 0",
				"align-content": "center",
			}}
		>
			<Select broadcast={props.broadcast} />
			<Status broadcast={props.broadcast} />
		</div>
	);
}

function Status(props: { broadcast: Broadcast }): JSX.Element {
	const url = solid(props.broadcast.connection.url);
	const status = solid(props.broadcast.connection.status);
	const audio = solid(props.broadcast.audio.catalog);
	const video = solid(props.broadcast.video.catalog);

	return (
		<div>
			<Switch>
				<Match when={!url()}>🔴&nbsp;No URL</Match>
				<Match when={status() === "disconnected"}>🔴&nbsp;Disconnected</Match>
				<Match when={status() === "connecting"}>🟡&nbsp;Connecting...</Match>
				<Match when={!audio() && !video()}>🔴&nbsp;Select Device</Match>
				<Match when={!audio() && video()}>🟡&nbsp;Video Only</Match>
				<Match when={audio() && !video()}>🟡&nbsp;Audio Only</Match>
				<Match when={audio() && video()}>🟢&nbsp;Live</Match>
				<Match when={status() === "connected"}>🟢&nbsp;Connected</Match>
			</Switch>
		</div>
	);
}

function Select(props: { broadcast: Broadcast }): JSX.Element {
	const setDevice = (device: Device | undefined) => {
		props.broadcast.device.set(device);
	};

	const selected = createSelector(solid(props.broadcast.device));

	const buttonStyle = (id: Device | undefined) => ({
		cursor: "pointer",
		opacity: selected(id) ? 1 : 0.5,
	});

	return (
		<div style={{ display: "flex", gap: "16px" }}>
			Device:
			<button
				id="camera"
				title="Camera"
				type="button"
				onClick={() => setDevice("camera")}
				style={buttonStyle("camera")}
			>
				🎥
			</button>
			<button
				id="screen"
				title="Screen"
				type="button"
				onClick={() => setDevice("screen")}
				style={buttonStyle("screen")}
			>
				🖥️
			</button>
			<button
				id="none"
				title="Nothing"
				type="button"
				onClick={() => setDevice(undefined)}
				style={buttonStyle(undefined)}
			>
				🚫
			</button>
		</div>
	);
}
