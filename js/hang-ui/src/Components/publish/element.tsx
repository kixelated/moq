import { customElement } from "solid-element";
import { createSignal, onMount } from "solid-js";
import PublishControls from "./PublishControls";
import styles from "./styles.css";
import type HangPublish from "@kixelated/hang/publish/element";
import PublishControlsContextProvider from "./PublishControlsContextProvider";

customElement("hang-publish-ui", {}, function PublishControlsWebComponent(attributes, { element }) {
	const [hangPublishEl, setHangPublishEl] = createSignal<HangPublish>();

	onMount(() => {
		const publishEl = element.querySelector("hang-publish");

		if (publishEl) {
			setHangPublishEl(publishEl);
		}
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
