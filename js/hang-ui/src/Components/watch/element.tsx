import styles from "./styles.css";
import WatchControls from "./WatchControls";
import BufferingIndicator from "./BufferingIndicator";
import type HangWatch from "@kixelated/hang/watch/element";
import WatchControlsContextProvider from "./WatchControlsContextProvider";
import { customElement } from "solid-element";
import { createSignal, onMount } from "solid-js";

customElement("hang-publish-ui", {}, function PublishControlsWebComponent(_, { element }) {
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
