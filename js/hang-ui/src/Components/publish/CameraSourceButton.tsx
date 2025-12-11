import { Show, useContext } from "solid-js";
import MediaSourceSourceSelector from "./MediaSourceSelector";
import { PublishUIContext } from "./PublishUIContextProvider";

export default function CameraSourceButton() {
	const context = useContext(PublishUIContext);
	const onClick = () => {
		if (context?.hangPublish.source.peek() === "camera") {
			// Camera already selected, toggle video.
			context?.hangPublish.invisible.update((invisible) => !invisible);
		} else {
			context?.hangPublish.source.set("camera");
			context?.hangPublish.invisible.set(false);
		}
	};

	const onSourceSelected = (sourceId: MediaDeviceInfo["deviceId"]) => {
		const video = context?.hangPublish.video.peek();
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
