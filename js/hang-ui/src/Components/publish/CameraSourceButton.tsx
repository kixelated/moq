import { Show, useContext } from 'solid-js';
import MediaSourceSourceSelector from './MediaSourceSelector';
import { PublishUIContext } from './PublishUIContextProvider';

export default function CameraSourceButton() {
    const context = useContext(PublishUIContext);
    const onClick = () => {
        const hangPublishEl = context?.hangPublish();
        if (!hangPublishEl) return;

        if (hangPublishEl.source === 'camera') {
            // Camera already selected, toggle video.
            hangPublishEl.video = !hangPublishEl.video;
        } else {
            hangPublishEl.source = 'camera';
            hangPublishEl.video = true;
        }
    };

    const onSourceSelected = (sourceId: MediaDeviceInfo['deviceId']) => {
        const hangPublishEl = context?.hangPublish();
        if (!hangPublishEl) return;

        hangPublishEl.videoDevice = sourceId;
    };

    return (
        <div class="publishSourceButtonContainer">
            <button
                type="button"
                title="Camera"
                class={`publishButton publishSourceButton ${context?.cameraActive?.() ? 'active' : ''}`}
                onClick={onClick}
            >
                📷
            </button>
            <Show
                when={
                    context?.cameraActive?.() && context?.cameraDevices().length
                }
            >
                <MediaSourceSourceSelector
                    sources={context?.cameraDevices()}
                    selectedSource={context?.selectedCameraSource?.()}
                    onSelected={onSourceSelected}
                />
            </Show>
        </div>
    );
}
