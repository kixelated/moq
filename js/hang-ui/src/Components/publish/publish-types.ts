export type PublishSourceType = 'microphone' | 'camera' | 'screen' | 'nothing';
export type PublishStatus = 'no-url' | 'disconnected' | 'connecting' | 'live' | 'audio-only' | 'video-only' | 'select-source';
export interface HangPublishControlsElement extends HTMLElement {
    activeSources: PublishSourceType[];
    currentStatus: PublishStatus;
    selectedCameraSource?: MediaDeviceInfo['deviceId'];
    selectedMicrophoneSource?: MediaDeviceInfo['deviceId'];
    microphoneSources?: MediaDeviceInfo[];
    cameraSources?: MediaDeviceInfo[];
    screenSources?: MediaDeviceInfo[];
}
export interface PublishButtonProps {
    isActive: boolean;
    onClick: () => void;
}
