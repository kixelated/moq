import { Show, useContext } from "solid-js";
import MediaSourceSourceSelector from "./MediaSourceSelector";
import { PublishUIContext } from "./PublishUIContextProvider";

export default function CameraSourceButton() {
	const context = useContext(PublishUIContext);
	const onClick = () => {
		const hangPublishEl = context?.hangPublish();
		if (!hangPublishEl) return;

		if (hangPublishEl.source.peek() === "camera") {
			// Camera already selected, toggle video.
			hangPublishEl.invisible.update(invisible => !invisible);
		} else {
			hangPublishEl.source.set("camera");
			hangPublishEl.invisible.set(false);
		}
	};

	const onSourceSelected = (sourceId: MediaDeviceInfo["deviceId"]) => {
		const hangPublishEl = context?.hangPublish();
		if (!hangPublishEl) return;

		const video = hangPublishEl.video.peek();
		if (!video || !("device" in video)) return;

		video.device.preferred.set(sourceId);
	};

	return (
		<div class="publishSourceButtonContainer">
			<button
				type="button"
				title="Camera"
				class={`publishButton publishSourceButton ${context?.cameraActive?.() ? "active" : ""}`}
				onClick={onClick}
			>
				📷
			</button>
			<Show when={context?.cameraActive?.() && context?.cameraDevices().length}>
				<MediaSourceSourceSelector
					sources={context?.cameraDevices()}
					selectedSource={context?.selectedCameraSource?.()}
					onSelected={onSourceSelected}
				/>
			</Show>
		</div>
	);
}
