import { PublishButtonProps } from './publish-types';
import MediaSourceSourceSelector from './MediaSourceSelector';
import { Show } from 'solid-js';

interface MicrophonePublishSourceButtonProps extends PublishButtonProps {
    microphoneSources?: MediaDeviceInfo[];
    selectedMicrophoneSource?: MediaDeviceInfo['deviceId'];
    onMicrophoneSourceSelected?: (sourceId: string) => void;
}

export default function MicrophoneSourceButton(
    props: MicrophonePublishSourceButtonProps
) {
    return (
        <div class="publishSourceButtonContainer">
            <button
                title="Microphone"
                class={`publishSourceButton ${props.isActive ? 'active' : ''}`}
                onClick={props.onClick}
            >
                🎤
            </button>
            <Show when={props.isActive && props.microphoneSources?.length}>
                <MediaSourceSourceSelector
                    sources={props.microphoneSources}
                    selectedSource={props.selectedMicrophoneSource}
                    onSelected={props.onMicrophoneSourceSelected}
                />
            </Show>
        </div>
    );
}
