import { Show, useContext } from 'solid-js';
import MediaSourceSourceSelector from './MediaSourceSelector';
import { PublishControlsContext } from './PublishControlsContextProvider';

export default function MicrophoneSourceButton() {
    const context = useContext(PublishControlsContext);
    const onClick = () => {
        const hangPublishEl = context?.hangPublish();
        if (!hangPublishEl) return;

        if (hangPublishEl.source === 'camera') {
            // Camera already selected, toggle audio.
            hangPublishEl.audio = !hangPublishEl.audio;
        } else {
            hangPublishEl.source = 'camera';
            hangPublishEl.audio = true;
        }
    };

    const onSourceSelected = (sourceId: MediaDeviceInfo['deviceId']) => {
        const hangPublishEl = context?.hangPublish();
        if (!hangPublishEl) return;

        hangPublishEl.audioDevice = sourceId;
    };

    return (
        <div class="publishSourceButtonContainer">
            <button
                type="button"
                title="Microphone"
                class={`publishButton publishSourceButton ${context?.microphoneActive() ? 'active' : ''}`}
                onClick={onClick}
            >
                🎤
            </button>
            <Show
                when={
                    context?.microphoneActive() &&
                    context?.microphoneDevices().length
                }
            >
                <MediaSourceSourceSelector
                    sources={context?.microphoneDevices()}
                    selectedSource={context?.selectedMicrophoneSource?.()}
                    onSelected={onSourceSelected}
                />
            </Show>
        </div>
    );
}
