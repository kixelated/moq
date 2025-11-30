import type HangWatch from "@kixelated/hang/watch/element";
import { customElement } from "solid-element";
import { createSignal, onMount } from "solid-js";
import BufferingIndicator from "./BufferingIndicator";
import styles from "./styles.css?inline";
import WatchControls from "./WatchControls";
import WatchUIContextProvider from "./WatchUIContextProvider";

customElement("hang-watch-ui", {}, function PublishControlsWebComponent(_, { element }) {
	const [hangWatchEl, setHangWatchEl] = createSignal<HangWatch>();

	onMount(() => {
		const watchEl = element.querySelector("hang-watch");

		if (watchEl) {
			setHangWatchEl(watchEl);
		} else {
			element.addEventListener(
				"watch-instance-available",
				(event: CustomEvent) => {
					const hangWatchEl = event.target as HangWatch;
					setHangWatchEl(hangWatchEl);
				},
				{ once: true }
			);
		}
	});

	return (
		<WatchUIContextProvider hangWatch={hangWatchEl}>
			<style>{styles}</style>
			<div class="watchVideoContainer">
				<slot />
				<BufferingIndicator />
			</div>
			<WatchControls />
		</WatchUIContextProvider>
	);
});
