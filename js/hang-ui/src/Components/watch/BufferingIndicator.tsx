import { Show, useContext } from 'solid-js';
import { WatchControlsContext } from './WatchControlsContextProvider';

export default function BufferingIndicator() {
    const context = useContext(WatchControlsContext);

    return (
        <Show when={context?.buffering()}>
            <div class="bufferingContainer">
                <div class="bufferingSpinner" />
            </div>
        </Show>
    );
}
