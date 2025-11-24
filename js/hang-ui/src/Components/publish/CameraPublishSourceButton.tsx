import MediaSourceSourceSelector from './MediaSourceSelector';
import type { PublishButtonProps } from './publish-types';

interface CameraPublishSourceButtonProps extends PublishButtonProps {
    videoSources?: MediaDeviceInfo[];
    onVideoSourceSelected?: (sourceId: string) => void;
    requestedVideoSource?: MediaDeviceInfo['deviceId'];
}

export default function CameraPublishSourceButton({
    isActive,
    onClick,
    onVideoSourceSelected,
    videoSources,
}: CameraPublishSourceButtonProps) {
    return (
        <div class="publishSourceButtonContainer">
            <button
                title="Camera"
                class={`publishSourceButton ${isActive ? 'active' : ''}`}
                onClick={onClick}
            >
                📷
            </button>
            <MediaSourceSourceSelector
                sources={videoSources}
                onSelected={onVideoSourceSelected}
                isActive={isActive}
            />
        </div>
    );
}
