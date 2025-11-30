import { Show, useContext } from 'solid-js';
import { WatchUIContext } from './WatchUIContextProvider';

export default function BufferingIndicator() {
    const context = useContext(WatchUIContext);

    return (
        <Show when={context?.buffering()}>
            <div class="bufferingContainer">
                <div class="bufferingSpinner" />
            </div>
        </Show>
    );
}
