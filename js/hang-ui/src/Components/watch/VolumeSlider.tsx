import { createEffect, createSignal, useContext } from "solid-js";
import { WatchControlsContext } from "./WatchControlsContextProvider";

export default function VolumeSlider() {
	const [volumeLabel, setVolumeLabel] = createSignal<number>(0);
	const context = useContext(WatchControlsContext);

	const onInputChange = (event: Event) => {
		const el = event.currentTarget as HTMLInputElement;
		const volume = parseFloat(el.value);
		context?.setVolume(volume);
	};

	createEffect(() => {
		const currentVolume = context?.currentVolume() || 0;
		setVolumeLabel(Math.round(currentVolume));
	});

	return (
		<div class="volumeSliderContainer">
			<button title="Muted" class="watchControlButton" onClick={() => context?.toggleMuted()}>
				{context?.isMuted() ? "🔇" : "🔊"}
			</button>
			<input type="range" onChange={onInputChange} min="0" max="100" value={context?.currentVolume()} />
			<span class="volumeLabel">{volumeLabel()}</span>
		</div>
	);
}
