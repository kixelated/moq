import { useContext } from "solid-js";
import { WatchControlsContext } from "./WatchControlsContextProvider";

export default function PlayPauseButton() {
	const context = useContext(WatchControlsContext);
	const onClick = () => {
		context?.togglePlayback();
	};

	return (
		<button
			type="button"
			title={context?.isPlaying() ? "Pause" : "Play"}
			class="watchControlButton"
			onClick={onClick}
		>
			{context?.isPlaying() ? "⏸️" : "▶️"}
		</button>
	);
}
