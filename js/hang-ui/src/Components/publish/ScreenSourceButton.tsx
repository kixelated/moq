import { useContext } from 'solid-js';
import { PublishUIContext } from './PublishUIContextProvider';

export default function ScreenSourceButton() {
    const context = useContext(PublishUIContext);
    const onClick = () => {
        const hangPublishEl = context?.hangPublish();
        if (!hangPublishEl) return;

        hangPublishEl.source = 'screen';
        hangPublishEl.audio = false;
        hangPublishEl.video = true;
    };

    return (
        <div class="publishSourceButtonContainer">
            <button
                type="button"
                title="Screen"
                class={`publishButton publishSourceButton ${context?.screenActive?.() ? 'active' : ''}`}
                onClick={onClick}
            >
                🖥️
            </button>
        </div>
    );
}
