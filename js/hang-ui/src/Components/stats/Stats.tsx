import { type Context, Show, useContext } from "solid-js";
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

	return (
		<div class="stats">
			<style>{styles}</style>
			<Show when={props.getElement(contextValue)}>
				{(element) => (
					<StatsContext.Provider
						value={{
							audio: element().audio,
							video: element().video,
						}}
					>
						<StatsWrapper />
					</StatsContext.Provider>
				)}
			</Show>
		</div>
	);
};
