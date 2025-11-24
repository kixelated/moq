import type { PublishSourceType, PublishStatus } from './publish-types';
import CameraPublishSourceButton from './CameraPublishSourceButton';
import PublishStatusIndicator from './PublishStatusIndicator';

type PublishControlsProps = {
    activeSources: PublishSourceType[];
    currentStatus: PublishStatus;
    videoSources: MediaDeviceInfo[];
    audioSources: MediaDeviceInfo[];
    onAudioSourceSelected: (
        selectedSource: MediaDeviceInfo['deviceId']
    ) => void;
    onVideoSourceSelected: (
        selectedSource: MediaDeviceInfo['deviceId']
    ) => void;
    onSourceSelected: (selectedSource: PublishSourceType) => void;
};

export default function PublishControls(props: PublishControlsProps) {
    return (
        <div class="publishControlsContainer">
            <div class="publishSourceSelectorContainer">
                Source:
                <CameraPublishSourceButton
                    isActive={props.activeSources.includes('camera')}
                    onClick={() => props.onSourceSelected('camera')}
                    videoSources={props.videoSources}
                    onVideoSourceSelected={props.onVideoSourceSelected}
                />
            </div>
            <PublishStatusIndicator currentStatus={props.currentStatus} />
        </div>
    );
}
