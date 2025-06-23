import { Root, Signal } from "@kixelated/signals";
import solid from "@kixelated/signals/solid";
import { Show } from "solid-js";
import { render } from "solid-js/web";
import { Connection } from "../connection";
import { Broadcast, Device } from "./broadcast";

export default class HangPublish extends HTMLElement {
	static observedAttributes = ["url", "path", "device", "audio", "video", "controls"];

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

	attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null) {
		if (name === "url") {
			this.connection.url.set(newValue ? new URL(newValue) : undefined);
		} else if (name === "path") {
			this.broadcast.path.set(newValue ?? "");
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

import { Match, Switch, createSelector } from "solid-js";
import { JSX } from "solid-js/jsx-runtime";

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
