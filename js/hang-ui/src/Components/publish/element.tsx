import type HangPublish from "@kixelated/hang/publish/element";
import { customElement } from "solid-element";
import { createSignal, onCleanup, onMount } from "solid-js";
import PublishControls from "./PublishControls";
import PublishControlsContextProvider from "./PublishUIContextProvider";
import styles from "./styles.css?inline";

customElement("hang-publish-ui", {}, function PublishControlsWebComponent(_, { element }) {
	const [hangPublishEl, setHangPublishEl] = createSignal<HangPublish>();

	const onInstanceAvailable = (event: CustomEvent) => {
		const hangPublishEl = event.target as HangPublish;
		setHangPublishEl(hangPublishEl);
	};

	onMount(() => {
		const publishEl = element.querySelector("hang-publish");

		if (publishEl) {
			setHangPublishEl(publishEl);
		} else {
			element.addEventListener("publish-instance-available", onInstanceAvailable);
		}
	});

	onCleanup(() => {
		element.removeEventListener("publish-instance-available", onInstanceAvailable);
	});

	return (
		<>
			<style>{styles}</style>
			<slot></slot>
			<PublishControlsContextProvider hangPublish={hangPublishEl}>
				<PublishControls />
			</PublishControlsContextProvider>
		</>
	);
});
