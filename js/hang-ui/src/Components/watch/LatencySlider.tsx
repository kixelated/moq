import { useContext } from "solid-js";
import { WatchUIContext } from "./WatchUIContextProvider";

const MIN_RANGE = 0;
const MAX_RANGE = 200_000;
const RANGE_STEP = 100;

export default function LatencySlider() {
	const context = useContext(WatchUIContext);
	const onInputChange = (event: Event) => {
		const target = event.currentTarget as HTMLInputElement;
		const latency = parseFloat(target.value);
		context?.setLatencyValue(latency);
	};

	return (
		<div class="latencySliderContainer">
			<span class="latencyLabel">Latency: </span>
			<input
				onChange={onInputChange}
				class="latencySlider"
				type="range"
				min={MIN_RANGE}
				max={MAX_RANGE}
				step={RANGE_STEP}
				value={context?.latency()}
			/>
			<span>{typeof context?.latency() !== "undefined" ? `${Math.round(context?.latency())}ms` : ""}</span>
		</div>
	);
}
