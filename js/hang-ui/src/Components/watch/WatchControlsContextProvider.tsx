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
	isPlaying: () => boolean;
	isMuted: () => boolean;
	setVolume: (vol: number) => void;
	currentVolume: () => number;
	togglePlayback: () => void;
	toggleMuted: () => void;
	buffering: () => boolean;
};

export const WatchControlsContext = createContext<WatchControlsContextValue>();

export default function WatchControlsContextProvider(props: WatchControlsContextProviderProps) {
	const [watchStatus, setWatchStatus] = createSignal<WatchStatus>("no-url");
	const [isPlaying, setIsPlaying] = createSignal<boolean>(false);
	const [isMuted, setIsMuted] = createSignal<boolean>(false);
	const [currentVolume, setCurrentVolume] = createSignal<number>(0);
	const [buffering, setBuffering] = createSignal<boolean>(false);

	const togglePlayback = () => {
		const hangWatchEl = props.hangWatch();

		if (hangWatchEl) {
			hangWatchEl.paused = !hangWatchEl.paused;
		}
	};

	const setVolume = (volume: number) => {
		const hangWatchEl = props.hangWatch();

		if (hangWatchEl) {
			hangWatchEl.volume = volume / 100;
		}
	};

	const toggleMuted = () => {
		setIsMuted(!isMuted());

		const hangWatchEl = props.hangWatch();

		if (hangWatchEl) {
			hangWatchEl.muted = isMuted();
		}
	};

	const value: WatchControlsContextValue = {
		hangWatch: props.hangWatch,
		watchStatus,
		togglePlayback,
		isPlaying,
		setVolume,
		isMuted,
		currentVolume,
		toggleMuted,
		buffering,
	};

	createEffect(() => {
		const hangWatchEl = props.hangWatch();
		if (!hangWatchEl) return;

		if (!hangWatchEl.active) {
			// @ts-ignore ignore custom event - todo add event map
			hangWatchEl.addEventListener("watch-instance-available", (event: CustomEvent) => {
				const watchInstance = event.detail.instance.peek?.() as HangWatchInstance;
				onWatchInstanceAvailable(watchInstance);
			});
		} else {
			const hangWatchInstance = hangWatchEl.active.peek?.() as HangWatchInstance;
			onWatchInstanceAvailable(hangWatchInstance);
		}
	});

	return <WatchControlsContext.Provider value={value}>{props.children}</WatchControlsContext.Provider>;

	function onWatchInstanceAvailable(watchInstance: HangWatchInstance) {
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

		watchInstance?.signals.effect(function trackPlaying(effect) {
			const paused = effect.get(watchInstance?.video.paused);
			setIsPlaying(!paused);
		});

		watchInstance?.signals.effect(function trackVolume(effect) {
			const volume = effect.get(watchInstance?.audio.volume);
			setCurrentVolume(volume * 100);
		});

		watchInstance?.signals.effect(function trackBuffering(effect) {
			const syncStatus = effect.get(watchInstance?.video.source.syncStatus);
			const bufferStatus = effect.get(watchInstance?.video.source.bufferStatus);
			const shouldShow = syncStatus.state === "wait" || bufferStatus.state === "empty";

			setBuffering(shouldShow);
		});
	}
}
