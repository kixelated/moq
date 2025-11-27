export type PublishSourceType = 'microphone' | 'camera' | 'screen' | 'nothing';
export type PublishStatus = 'no-url' | 'disconnected' | 'connecting' | 'live' | 'audio-only' | 'video-only' | 'select-source';
export interface HangPublishControlsElement extends HTMLElement {
    url: string;
    path: string;
}
