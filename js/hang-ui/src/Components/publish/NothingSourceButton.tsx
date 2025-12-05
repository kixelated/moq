import { useContext } from "solid-js";
import { PublishUIContext } from "./PublishUIContextProvider";

export default function NothingSourceButton() {
	const context = useContext(PublishUIContext);
	const onClick = () => {
		const hangPublishEl = context?.hangPublish();
		if (!hangPublishEl) return;

		hangPublishEl.source.set(undefined);
		hangPublishEl.muted.set(true);
		hangPublishEl.invisible.set(true);
	};

	return (
		<div class="publishSourceButtonContainer">
			<button
				type="button"
				title="No Source"
				class={`publishButton publishSourceButton ${context?.nothingActive?.() ? "active" : ""}`}
				onClick={onClick}
			>
				🚫
			</button>
		</div>
	);
}
