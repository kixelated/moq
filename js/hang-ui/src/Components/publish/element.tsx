import { customElement } from 'solid-element';
import PublishControls from './PublishControls';
import styles from './styles.css';
import type { PublishSourceType, PublishStatus } from './publish-types';

customElement(
    'hang-publish-controls',
    {
        activeSources: [],
        currentStatus: 'no-url' as PublishStatus,
        videoSources: [],
        audioSources: [],
    },
    function PublishControlsWebComponent(attributes, { element }) {
        const onSourceSelected = (newSource: PublishSourceType) => {
            element.dispatchEvent(
                new CustomEvent('sourceselectionchange', {
                    detail: newSource,
                })
            );
        };

        const onAudioSourceSelected = (
            selectedSource: MediaDeviceInfo['deviceId']
        ) => {
            element.dispatchEvent(
                new CustomEvent('audiosourceselected', {
                    detail: selectedSource,
                })
            );
        };

        const onVideoSourceSelected = (
            selectedSource: MediaDeviceInfo['deviceId']
        ) => {
            element.dispatchEvent(
                new CustomEvent('videosourceselected', {
                    detail: selectedSource,
                })
            );
        };

        return (
            <>
                <style>{styles}</style>
                <PublishControls
                    {...attributes} // 👈 stays reactive
                    onSourceSelected={onSourceSelected}
                    onAudioSourceSelected={onAudioSourceSelected}
                    onVideoSourceSelected={onVideoSourceSelected}
                />
            </>
        );
    }
);
