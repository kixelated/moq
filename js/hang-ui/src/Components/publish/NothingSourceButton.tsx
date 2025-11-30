import { useContext } from 'solid-js';
import { PublishControlsContext } from './PublishControlsContextProvider';

export default function NothingSourceButton() {
    const context = useContext(PublishControlsContext);
    const onClick = () => {
        const hangPublishEl = context?.hangPublish();
        if (!hangPublishEl) return;

        hangPublishEl.source = undefined;
        hangPublishEl.video = false;
        hangPublishEl.audio = false;
    };

    return (
        <div class="publishSourceButtonContainer">
            <button
                type="button"
                title="No Source"
                class={`publishButton publishSourceButton ${context?.nothingActive?.() ? 'active' : ''}`}
                onClick={onClick}
            >
                🚫
            </button>
        </div>
    );
}
