import { useContext } from 'solid-js';
import { WatchUIContext } from './WatchUIContextProvider';

export default function FullscreenButton() {
    const context = useContext(WatchUIContext);
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
