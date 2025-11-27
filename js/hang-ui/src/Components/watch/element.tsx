import { customElement } from "solid-element";
import { createSignal, onMount } from "solid-js";
import WatchControls from "./WatchControls";
import styles from "./styles.css";
import type HangWatch from "@kixelated/hang/watch/element";
import WatchControlsContextProvider from "./WatchControlsContextProvider";

customElement("hang-publish-ui", {}, function PublishControlsWebComponent(attributes, { element }) {
	const [hangWatchhEl, setHangWatchEl] = createSignal<HangWatch>();

	onMount(() => {
		const watchEl = element.querySelector("hang-watch");

		if (watchEl) {
			setHangWatchEl(watchEl);
		}
	});

	return (
		<>
			<style>{styles}</style>
			<slot></slot>
			<WatchControlsContextProvider hangWatch={hangWatchhEl}>
				<WatchControls />
			</WatchControlsContextProvider>
		</>
	);
});
