import type HangWatch from "@kixelated/hang/watch/element";
import { customElement } from "solid-element";
import { createSignal, onMount } from "solid-js";
import BufferingIndicator from "./BufferingIndicator";
import styles from "./styles.css";
import WatchControls from "./WatchControls";
import WatchControlsContextProvider from "./WatchControlsContextProvider";

customElement("hang-watch-ui", {}, function PublishControlsWebComponent(_, { element }) {
	const [hangWatchhEl, setHangWatchEl] = createSignal<HangWatch>();

	onMount(() => {
		const watchEl = element.querySelector("hang-watch");

		if (watchEl) {
			setHangWatchEl(watchEl);
		}
	});

	return (
		<WatchControlsContextProvider hangWatch={hangWatchhEl}>
			<style>{styles}</style>
			<div class="watchVideoContainer">
				<slot />
				<BufferingIndicator />
			</div>
			<WatchControls />
		</WatchControlsContextProvider>
	);
});
