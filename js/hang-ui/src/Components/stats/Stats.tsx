import { type Context, createEffect, createSignal, Show, useContext } from "solid-js";
import { StatsWrapper } from "./components/StatsWrapper";
import { StatsContext } from "./context";
import styles from "./style/index.scss?inline";
import type { HandlerProps } from "./types";

interface StatsProps<T = unknown> {
	context: Context<T>;
	getElement: (ctx: T) => HandlerProps | undefined;
}

/**
 * Stats component for displaying real-time media streaming metrics
 * Accepts a generic context and a function to extract the media element
 */
export const Stats = <T = unknown>(props: StatsProps<T>) => {
	const contextValue = useContext(props.context);
	const [statsReady, setStatsReady] = createSignal(false);

	// Wait for element to be available before rendering
	createEffect(() => {
		const element = props.getElement(contextValue);
		if (element?.audio && element?.video) {
			setStatsReady(true);
		}
	});

	return (
		<div class="stats">
			<style>{styles}</style>
			<Show when={statsReady()}>
				<StatsContext.Provider
					value={{
						audio: props.getElement(contextValue)?.audio,
						video: props.getElement(contextValue)?.video,
					}}
				>
					<StatsWrapper />
				</StatsContext.Provider>
			</Show>
		</div>
	);
};
