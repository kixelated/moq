import { customElement } from 'solid-element';
import PublishControls from './PublishControls';
import styles from './styles.css';
import type { PublishSourceType, PublishStatus } from './publish-types';

customElement(
    'hang-publish-controls',
    {
        activeSources: [] as PublishSourceType[],
        selectedCameraSource: undefined,
        selectedMicrophoneSource: undefined,
        currentStatus: 'no-url' as PublishStatus,
        cameraSources: [],
        microphoneSources: [],
    },
    function PublishControlsWebComponent(attributes, { element }) {
        const onSourceSelected = (newSource: PublishSourceType) => {
            element.dispatchEvent(
                new CustomEvent('sourceselectionchange', {
                    detail: newSource,
                })
            );
        };

        const onMicrophoneSourceSelected = (
            selectedSource: MediaDeviceInfo['deviceId']
        ) => {
            element.dispatchEvent(
                new CustomEvent('microphonesourceselected', {
                    detail: selectedSource,
                })
            );
        };

        const onCameraSourceSelected = (
            selectedSource: MediaDeviceInfo['deviceId']
        ) => {
            element.dispatchEvent(
                new CustomEvent('camerasourceselected', {
                    detail: selectedSource,
                })
            );
        };

        return (
            <>
                <style>{styles}</style>
                <PublishControls
                    {...attributes}
                    onSourceSelected={onSourceSelected}
                    onMicrophoneSourceSelected={onMicrophoneSourceSelected}
                    onCameraSourceSelected={onCameraSourceSelected}
                />
            </>
        );
    }
);
