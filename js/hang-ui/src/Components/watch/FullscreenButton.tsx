import { useContext } from 'solid-js';
import { WatchControlsContext } from './WatchControlsContextProvider';

export default function FullscreenButton() {
    const context = useContext(WatchControlsContext);
    const onClick = () => {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            context?.hangWatch()?.requestFullscreen();
        }
    };

    return (
        <button
            type="button"
            title="Fullscreen"
            class="watchControlButton"
            onClick={onClick}
        >
            ⛶
        </button>
    );
}
