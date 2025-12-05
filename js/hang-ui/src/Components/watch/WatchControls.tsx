import FullscreenButton from "./FullscreenButton";
import LatencySlider from "./LatencySlider";
import PlayPauseButton from "./PlayPauseButton";
import VolumeSlider from "./VolumeSlider";
import WatchStatusIndicator from "./WatchStatusIndicator";

export default function WatchControls() {
	return (
		<div class="watchControlsContainer">
			<div class="playbackControlsRow">
				<PlayPauseButton />
				<VolumeSlider />
				<WatchStatusIndicator />
				<FullscreenButton />
			</div>
			<div class="latencyControlsRow">
				<LatencySlider />
			</div>
		</div>
	);
}
