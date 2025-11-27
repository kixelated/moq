import { customElement } from 'solid-element';
import { createSignal } from 'solid-js';
import PublishControls from './PublishControls';
import styles from './styles.css';
import type HangPublish from '@kixelated/hang/publish/element';
import PublishControlsContextProvider from './PublishControlsContextProvider';

customElement(
    'hang-publish-ui',
    {
        url: '' as string,
        path: '' as string,
    },
    function PublishControlsWebComponent(attributes) {
        const [hangPublishEl, setHangPublishEl] = createSignal<HangPublish>();

        return (
            <>
                <style>{styles}</style>
                <hang-publish
                    url={attributes.url}
                    path={attributes.path}
                    ref={setHangPublishEl}
                >
                    <video
                        style="width: 100%; height: auto; border-radius: 4px; margin: 0 auto;"
                        muted
                        autoplay
                    ></video>
                </hang-publish>
                <PublishControlsContextProvider hangPublish={hangPublishEl}>
                    <PublishControls />
                </PublishControlsContextProvider>
            </>
        );
    }
);
