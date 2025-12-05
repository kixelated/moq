import type { Time } from "@kixelated/hang";
import type HangWatch from "@kixelated/hang/watch/element";
import type { JSX } from "solid-js";
import { createContext, createEffect, createSignal } from "solid-js";

type WatchUIContextProviderProps = {
	hangWatch: () => HangWatch | undefined;
	children: JSX.Element;
};

type WatchStatus = "no-url" | "disconnected" | "connecting" | "offline" | "loading" | "live" | "connected";

type WatchUIContextValues = {
	hangWatch: () => HangWatch | undefined;
	watchStatus: () => WatchStatus;
	isPlaying: () => boolean;
	isMuted: () => boolean;
	setVolume: (vol: number) => void;
	currentVolume: () => number;
	togglePlayback: () => void;
	toggleMuted: () => void;
	buffering: () => boolean;
	latency: () => number;
	setLatencyValue: (value: number) => void;
};

export const WatchUIContext = createContext<WatchUIContextValues>();

export default function WatchUIContextProvider(props: WatchUIContextProviderProps) {
	const [watchStatus, setWatchStatus] = createSignal<WatchStatus>("no-url");
	const [isPlaying, setIsPlaying] = createSignal<boolean>(false);
	const [isMuted, setIsMuted] = createSignal<boolean>(false);
	const [currentVolume, setCurrentVolume] = createSignal<number>(0);
	const [buffering, setBuffering] = createSignal<boolean>(false);
	const [latency, setLatency] = createSignal<number>(0);

	const togglePlayback = () => {
		const hangWatchEl = props.hangWatch();

		if (hangWatchEl) {
			hangWatchEl.paused.set(!hangWatchEl.paused.get());
		}
	};

	const setVolume = (volume: number) => {
		const hangWatchEl = props.hangWatch();

		if (hangWatchEl) {
			hangWatchEl.volume.set(volume / 100);
		}
	};

	const toggleMuted = () => {
		const hangWatchEl = props.hangWatch();

		if (hangWatchEl) {
			hangWatchEl.muted.update(muted => !muted);
		}
	};

	const setLatencyValue = (latency: number) => {
		const hangWatchEl = props.hangWatch();

		if (hangWatchEl) {
			hangWatchEl.latency.set(latency as Time.Milli);
		}
	};

	const value: WatchUIContextValues = {
		hangWatch: props.hangWatch,
		watchStatus,
		togglePlayback,
		isPlaying,
		setVolume,
		isMuted,
		currentVolume,
		toggleMuted,
		buffering,
		latency,
		setLatencyValue,
	};

	createEffect(() => {
		const watch = props.hangWatch();
		if (!watch) return;

		watch.signals.effect((effect) => {
			const url = effect.get(watch.connection.url);
			const connection = effect.get(watch.connection.status);
			const broadcast = effect.get(watch.broadcast.status);

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

		watch.signals.effect((effect) => {
			const paused = effect.get(watch.video.paused);
			setIsPlaying(!paused);
		});

		watch.signals.effect((effect) => {
			const volume = effect.get(watch.audio.volume);
			setCurrentVolume(volume * 100);
		});

		watch.signals.effect((effect) => {
			const muted = effect.get(watch.audio.muted);
			setIsMuted(muted);
		});

		watch.signals.effect((effect) => {
			const syncStatus = effect.get(watch.video.source.syncStatus);
			const bufferStatus = effect.get(watch.video.source.bufferStatus);
			const shouldShow = syncStatus.state === "wait" || bufferStatus.state === "empty";

			setBuffering(shouldShow);
		});

		watch.signals.effect((effect) => {
			const latency = effect.get(watch.latency);
			setLatency(latency);
		});
	});

	return <WatchUIContext.Provider value={value}>{props.children}</WatchUIContext.Provider>;
}
