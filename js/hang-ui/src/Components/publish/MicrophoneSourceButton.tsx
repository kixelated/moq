import { Show, useContext } from "solid-js";
import MediaSourceSourceSelector from "./MediaSourceSelector";
import { PublishUIContext } from "./PublishUIContextProvider";

export default function MicrophoneSourceButton() {
	const context = useContext(PublishUIContext);
	const onClick = () => {
		const hangPublishEl = context?.hangPublish();
		if (!hangPublishEl) return;

		if (hangPublishEl.source.peek() === "camera") {
			// Camera already selected, toggle audio.
			hangPublishEl.muted.set(!hangPublishEl.muted.peek());
		} else {
			hangPublishEl.source.set("camera");
			hangPublishEl.muted.set(false);
		}
	};

	const onSourceSelected = (sourceId: MediaDeviceInfo["deviceId"]) => {
		const hangPublishEl = context?.hangPublish();
		if (!hangPublishEl) return;

		const audio = hangPublishEl.audio.peek();
		if (!audio || !("device" in audio)) return;

		audio.device.preferred.set(sourceId);
	};

	return (
		<div class="publishSourceButtonContainer">
			<button
				type="button"
				title="Microphone"
				class={`publishButton publishSourceButton ${context?.microphoneActive() ? "active" : ""}`}
				onClick={onClick}
			>
				🎤
			</button>
			<Show when={context?.microphoneActive() && context?.microphoneDevices().length}>
				<MediaSourceSourceSelector
					sources={context?.microphoneDevices()}
					selectedSource={context?.selectedMicrophoneSource?.()}
					onSelected={onSourceSelected}
				/>
			</Show>
		</div>
	);
}
