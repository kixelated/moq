import { createContext, createEffect, createSignal } from "solid-js";
import type HangWatch from "@kixelated/hang/watch/element";
import type { HangWatchInstance } from "@kixelated/hang/watch/element";

type WatchControlsContextProviderProps = {
	hangWatch: () => HangWatch | undefined;
	children: any;
};

type WatchStatus = "no-url" | "disconnected" | "connecting" | "offline" | "loading" | "live" | "connected";

type WatchControlsContextValue = {
	hangWatch: () => HangWatch | undefined;
	watchStatus: () => WatchStatus;
};

export const WatchControlsContext = createContext<WatchControlsContextValue>();

export default function WatchControlsContextProvider(props: WatchControlsContextProviderProps) {
	const [watchStatus, setWatchStatus] = createSignal<WatchStatus>("no-url");

	const value: WatchControlsContextValue = {
		hangWatch: props.hangWatch,
		watchStatus,
	};

	createEffect(() => {
		const hangWatchEl = props.hangWatch();
		if (!hangWatchEl) return;

		if (!hangWatchEl.active) {
			// @ts-ignore ignore custom event - todo add event map
			hangWatchEl.addEventListener("watch-instance-available", (event: CustomEvent) => {
				const watchInstance = event.detail.instance.peek?.() as HangWatchInstance;
				onWatchInstanceAvailable(hangWatchEl, watchInstance);
			});
		}
	});

	return <WatchControlsContext.Provider value={value}>{props.children}</WatchControlsContext.Provider>;

	function onWatchInstanceAvailable(el: HangWatch, watchInstance: HangWatchInstance) {
		watchInstance?.signals.effect(function trackWatchStatus(effect) {
			const url = effect.get(watchInstance?.connection.url);
			const connection = effect.get(watchInstance?.connection.status);
			const broadcast = effect.get(watchInstance?.broadcast.status);

			if (!url) {
				setWatchStatus("no-url");
			} else if (connection === "disconnected") {
				setWatchStatus("disconnected");
			} else if (connection === "connecting") {
				setWatchStatus("connecting");
			} else if (broadcast === "offline") {
				setWatchStatus("offline");
			} else if (broadcast === "loading") {
				setWatchStatus("loading");
			} else if (broadcast === "live") {
				setWatchStatus("live");
			} else if (connection === "connected") {
				setWatchStatus("connected");
			}
		});
	}
}
