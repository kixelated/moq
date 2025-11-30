import { createSignal, For, Show } from "solid-js";

type MediaSourceSelectorProps = {
	sources?: MediaDeviceInfo[];
	selectedSource?: MediaDeviceInfo["deviceId"];
	onSelected?: (sourceId: MediaDeviceInfo["deviceId"]) => void;
};

export default function MediaSourceSelector(props: MediaSourceSelectorProps) {
	const [sourcesVisible, setSourcesVisible] = createSignal(false);

	const toggleSourcesVisible = () => {
		if (sourcesVisible()) {
			setSourcesVisible(false);
		} else {
			setSourcesVisible(true);
		}
	};

	return (
		<>
			<button
				type="button"
				onClick={toggleSourcesVisible}
				class="publishButton mediaSourceVisibilityToggle"
				title="Show Sources"
			>
				{sourcesVisible() ? "▼" : "▲"}
			</button>
			<Show when={sourcesVisible()}>
				<select
					value={props.selectedSource}
					class="mediaSourceSelector"
					onChange={(e) => props.onSelected?.(e.currentTarget.value as MediaDeviceInfo["deviceId"])}
				>
					<For each={props.sources}>
						{(source) => <option value={source.deviceId}>{source.label}</option>}
					</For>
				</select>
			</Show>
		</>
	);
}
