import { For, type JSX, useContext } from "solid-js";
import { WatchUIContext } from "./WatchUIContextProvider";

/**
 * Render a quality selector control that lets the user choose an available rendition or "Auto".
 *
 * When the selection changes, updates the watch UI context's active rendition to the selected rendition name,
 * or to `undefined` when "Auto" is chosen.
 *
 * @returns A JSX element containing a labeled select input populated with an "Auto" option and the available renditions.
 */
export default function QualitySelector() {
	const context = useContext(WatchUIContext);

	const handleQualityChange: JSX.EventHandler<HTMLSelectElement, Event> = (event) => {
		const selectedValue = event.currentTarget.value || undefined;
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
							{rendition.width && rendition.height ? ` (${rendition.width}x${rendition.height})` : ""}
						</option>
					)}
				</For>
			</select>
		</div>
	);
}