import WatchStatusIndicator from "./WatchStatusIndicator";
import FullscreenButton from "./FullscreenButton";

export default function WatchControls() {
	return (
		<div class="watchContainer">
			<WatchStatusIndicator />
			<FullscreenButton />
		</div>
	);
}
