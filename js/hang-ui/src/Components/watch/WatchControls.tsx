import FullscreenButton from "./FullscreenButton";
import LatencySlider from "./LatencySlider";
import PlayPauseButton from "./PlayPauseButton";
import QualitySelector from "./QualitySelector";
import VolumeSlider from "./VolumeSlider";
import WatchStatusIndicator from "./WatchStatusIndicator";

/**
 * Renders the watch controls panel with playback controls and latency/quality controls.
 *
 * The component organizes controls into two rows: playback controls (play/pause, volume, watch status, fullscreen)
 * and latency/quality controls (latency slider and quality selector).
 *
 * @returns The JSX element representing the watch controls panel.
 */
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
				<QualitySelector />
			</div>
		</div>
	);
}