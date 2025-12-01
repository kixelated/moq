import FullscreenButton from "./FullscreenButton";
import PlayPauseButton from "./PlayPauseButton";
import VolumeSlider from "./VolumeSlider";
import WatchStatusIndicator from "./WatchStatusIndicator";
import LatencySlider from "./LatencySlider";

export default function WatchControls() {
	return (
		<div class="watchControlsContainer">
			<PlayPauseButton />
			<VolumeSlider />
			<WatchStatusIndicator />
			<FullscreenButton />
			<LatencySlider />
		</div>
	);
}
