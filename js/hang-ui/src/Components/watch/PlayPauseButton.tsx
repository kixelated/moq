import { useContext } from 'solid-js';
import { WatchUIContext } from './WatchUIContextProvider';

export default function PlayPauseButton() {
    const context = useContext(WatchUIContext);
    const onClick = () => {
        context?.togglePlayback();
    };

    return (
        <button
            type="button"
            title={context?.isPlaying() ? 'Pause' : 'Play'}
            class="watchControlButton"
            onClick={onClick}
        >
            {context?.isPlaying() ? '⏸️' : '▶️'}
        </button>
    );
}
