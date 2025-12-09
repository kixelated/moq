import { createEffect, For, useContext } from "solid-js";
import { WatchUIContext } from "./WatchUIContextProvider";

export default function QualitySelector() {
	const context = useContext(WatchUIContext);

	const handleQualityChange = (event: Event) => {
		const target = event.currentTarget as HTMLSelectElement;
		const selectedValue = target.value || undefined;
		context?.setActiveRendition(selectedValue);
	};

	return (
		<div class="qualitySelectorContainer">
			<label for="quality-select" class="qualityLabel">
				Quality:{" "}
			</label>
			<select
				id="quality-select"
				onChange={handleQualityChange}
				class="qualitySelect"
				value={context?.activeRendition() ?? ""}
			>
				<option value="">Auto</option>
				<For each={context?.availableRenditions() ?? []}>
					{(rendition) => (
						<option value={rendition.name}>
							{rendition.name}
							{rendition.width && rendition.height
								? ` (${rendition.width}x${rendition.height})`
								: ""}
						</option>
					)}
				</For>
			</select>
		</div>
	);
}
