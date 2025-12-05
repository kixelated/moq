import type HangPublish from "@kixelated/hang/publish/element";
import { customElement } from "solid-element";
import { createSignal, onMount } from "solid-js";
import PublishControls from "./PublishControls";
import PublishControlsContextProvider from "./PublishUIContextProvider";
import styles from "./styles.css?inline";

customElement("hang-publish-ui", {}, function PublishControlsWebComponent(_, { element }) {
	const [hangPublishEl, setHangPublishEl] = createSignal<HangPublish | undefined>();

	onMount(async () => {
		const publishEl = element.querySelector("hang-publish");
		await customElements.whenDefined("hang-publish");
		setHangPublishEl(publishEl);
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
