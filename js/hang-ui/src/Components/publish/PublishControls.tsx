import type { PublishSourceType, PublishStatus } from './publish-types';
import CameraSourceButton from './CameraSourceButton';
import ScreenSourceButton from './ScreenSourceButton';
import MicrophoneSourceButton from './MicrophoneSourceButton';
import PublishStatusIndicator from './PublishStatusIndicator';
import NothingSourceButton from './NothingSourceButton';

type PublishControlsProps = {
    activeSources: PublishSourceType[];
    currentStatus: PublishStatus;
    selectedCameraSource?: MediaDeviceInfo['deviceId'];
    selectedMicrophoneSource?: MediaDeviceInfo['deviceId'];
    cameraSources: MediaDeviceInfo[];
    microphoneSources: MediaDeviceInfo[];
    onMicrophoneSourceSelected: (
        selectedSource: MediaDeviceInfo['deviceId']
    ) => void;
    onCameraSourceSelected: (
        selectedSource: MediaDeviceInfo['deviceId']
    ) => void;
    onSourceSelected: (selectedSource: PublishSourceType) => void;
};

export default function PublishControls(props: PublishControlsProps) {
    return (
        <div class="publishControlsContainer">
            <div class="publishSourceSelectorContainer">
                Source:
                <MicrophoneSourceButton
                    isActive={props.activeSources.includes('microphone')}
                    onClick={() => props.onSourceSelected('microphone')}
                    microphoneSources={props.microphoneSources}
                    selectedMicrophoneSource={props.selectedMicrophoneSource}
                    onMicrophoneSourceSelected={
                        props.onMicrophoneSourceSelected
                    }
                />
                <CameraSourceButton
                    isActive={props.activeSources.includes('camera')}
                    onClick={() => props.onSourceSelected('camera')}
                    cameraSources={props.cameraSources}
                    selectedCameraSource={props.selectedCameraSource}
                    onCameraSourceSelected={props.onCameraSourceSelected}
                />
                <ScreenSourceButton
                    isActive={props.activeSources.includes('screen')}
                    onClick={() => props.onSourceSelected('screen')}
                />
                <NothingSourceButton
                    isActive={props.activeSources.length === 0}
                    onClick={() => props.onSourceSelected('nothing')}
                />
            </div>
            <PublishStatusIndicator currentStatus={props.currentStatus} />
        </div>
    );
}
