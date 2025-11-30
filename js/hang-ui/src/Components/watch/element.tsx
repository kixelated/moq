import type HangWatch from "@kixelated/hang/watch/element";
import { customElement } from "solid-element";
import { createSignal, onCleanup, onMount } from "solid-js";
import BufferingIndicator from "./BufferingIndicator";
import styles from "./styles.css?inline";
import WatchControls from "./WatchControls";
import WatchUIContextProvider from "./WatchUIContextProvider";

customElement("hang-watch-ui", {}, function WatchUIWebComponent(_, { element }) {
	const [hangWatchEl, setHangWatchEl] = createSignal<HangWatch>();

	const onInstanceAvailable = (event: CustomEvent) => {
		const hangWatchEl = event.target as HangWatch;
		setHangWatchEl(hangWatchEl);
	};

	onMount(() => {
		const watchEl = element.querySelector("hang-watch");

		if (watchEl) {
			setHangWatchEl(watchEl);
		} else {
			element.addEventListener("watch-instance-available", onInstanceAvailable);
		}
	});

	onCleanup(() => {
		element.removeEventListener("watch-instance-available", onInstanceAvailable);
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
