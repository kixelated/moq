import CameraSourceButton from "./CameraSourceButton";
import ScreenSourceButton from "./ScreenSourceButton";
import MicrophoneSourceButton from "./MicrophoneSourceButton";
import PublishStatusIndicator from "./PublishStatusIndicator";
import FileSourceButton from "./FileSourceButton";
import NothingSourceButton from "./NothingSourceButton";

export default function PublishControls() {
	return (
		<div class="publishControlsContainer">
			<div class="publishSourceSelectorContainer">
				Source:
				<MicrophoneSourceButton />
				<CameraSourceButton />
				<ScreenSourceButton />
				<FileSourceButton />
				<NothingSourceButton />
			</div>
			<PublishStatusIndicator />
		</div>
	);
}
