import { useContext } from "solid-js";
import { PublishControlsContext } from "./PublishControlsContextProvider";

export default function ScreenSourceButton() {
	const context = useContext(PublishControlsContext);
	const onClick = () => {
		const hangPublishEl = context?.hangPublish();
		if (!hangPublishEl) return;

		hangPublishEl.source = "screen";
		hangPublishEl.audio = false;
		hangPublishEl.video = true;
	};

	return (
		<div class="publishSourceButtonContainer">
			<button
				type="button"
				title="Screen"
				class={`publishSourceButton ${context?.screenActive?.() ? "active" : ""}`}
				onClick={onClick}
			>
				🖥️
			</button>
		</div>
	);
}
