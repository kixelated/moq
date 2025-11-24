import MediaSourceSourceSelector from './MediaSourceSelector';
import type { PublishButtonProps } from './publish-types';
import { Show } from 'solid-js';

interface CameraPublishSourceButtonProps extends PublishButtonProps {
    cameraSources?: MediaDeviceInfo[];
    selectedCameraSource?: MediaDeviceInfo['deviceId'];
    onCameraSourceSelected?: (sourceId: string) => void;
}

export default function CameraSourceButton(
    props: CameraPublishSourceButtonProps
) {
    return (
        <div class="publishSourceButtonContainer">
            <button
                title="Camera"
                class={`publishSourceButton ${props.isActive ? 'active' : ''}`}
                onClick={props.onClick}
            >
                📷
            </button>
            <Show when={props.isActive && props.cameraSources?.length}>
                <MediaSourceSourceSelector
                    sources={props.cameraSources}
                    selectedSource={props.selectedCameraSource}
                    onSelected={props.onCameraSourceSelected}
                />
            </Show>
        </div>
    );
}
