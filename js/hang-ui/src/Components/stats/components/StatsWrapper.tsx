import { createSignal, Show } from "solid-js";
import { useMetrics } from "../context";
import { Button } from "./Button";
import { BUTTON_SVG } from "./icons";
import { StatsPanel } from "./StatsPanel";

/**
 * Root wrapper component managing visibility state and layout
 */
export const StatsWrapper = () => {
	const [isVisible, setIsVisible] = createSignal(false);
	const metrics = useMetrics();

	return (
		<div class="stats__wrapper">
			<Button isVisible={isVisible()} onToggle={setIsVisible} icon={BUTTON_SVG} />

			<Show when={isVisible()}>
				<StatsPanel audio={metrics.audio} video={metrics.video} />
			</Show>
		</div>
	);
};
