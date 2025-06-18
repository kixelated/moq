import { Match, Switch, createSelector } from "solid-js";
import { JSX } from "solid-js/jsx-runtime";
import { Broadcast, Device } from "./broadcast";
import solid from "@kixelated/signals/solid";

export function Controls(props: { broadcast: Broadcast }): JSX.Element {
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
