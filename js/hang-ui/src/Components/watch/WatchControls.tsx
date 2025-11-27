import WatchStatusIndicator from "./WatchStatusIndicator";
import FullscreenButton from "./FullscreenButton";
import PlayPauseButton from "./PlayPauseButton";
import VolumeSlider from "./VolumeSlider";

export default function WatchControls() {
	return (
		<div class="watchContainer">
			<PlayPauseButton />
			<VolumeSlider />
			<WatchStatusIndicator />
			<FullscreenButton />
		</div>
	);
}
