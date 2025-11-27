import CameraSourceButton from './CameraSourceButton';
import ScreenSourceButton from './ScreenSourceButton';
import MicrophoneSourceButton from './MicrophoneSourceButton';
import PublishStatusIndicator from './PublishStatusIndicator';
import NothingSourceButton from './NothingSourceButton';

export default function PublishControls() {
    return (
        <div class="publishControlsContainer">
            <div class="publishSourceSelectorContainer">
                Source:
                <MicrophoneSourceButton />
                <CameraSourceButton />
                <ScreenSourceButton />
                <NothingSourceButton />
            </div>
            <PublishStatusIndicator />
        </div>
    );
}
