export type PublishSourceType = 'microphone' | 'camera' | 'screen' | 'nothing';
export type PublishStatus = 'no-url' | 'disconnected' | 'connecting' | 'live' | 'audio-only' | 'video-only' | 'select-source';
export interface HangPublishControlsElement extends HTMLElement {
    activeSources: PublishSourceType[];
    currentStatus: PublishStatus;
    audioSources?: MediaDeviceInfo[];
    videoSources?: MediaDeviceInfo[];
    screenSources?: MediaDeviceInfo[];
}
export interface PublishButtonProps {
    isActive: boolean;
    onClick: () => void;
}
