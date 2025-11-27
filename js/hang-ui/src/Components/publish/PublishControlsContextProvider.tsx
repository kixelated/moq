import { createContext, createEffect, createSignal } from "solid-js";
import type HangPublish from "@kixelated/hang/publish/element";
import { HangPublishInstance } from "@kixelated/hang/publish/element";

type PublishStatus = "no-url" | "disconnected" | "connecting" | "live" | "audio-only" | "video-only" | "select-source";

type PublishControlsContextValue = {
	hangPublish: () => HangPublish | undefined;
	cameraDevices: () => MediaDeviceInfo[];
	microphoneDevices: () => MediaDeviceInfo[];
	publishStatus: () => PublishStatus;
	microphoneActive: () => boolean;
	cameraActive?: () => boolean;
	screenActive?: () => boolean;
	nothingActive?: () => boolean;
	selectedCameraSource?: () => MediaDeviceInfo["deviceId"] | undefined;
	selectedMicrophoneSource?: () => MediaDeviceInfo["deviceId"] | undefined;
};

type PublishControlsContextProviderProps = {
	hangPublish: () => HangPublish | undefined;
	children: any;
};

export const PublishControlsContext = createContext<PublishControlsContextValue>();

export default function PublishControlsContextProvider(props: PublishControlsContextProviderProps) {
	const [cameraDevices, setCameraMediaDevices] = createSignal<MediaDeviceInfo[]>([]);
	const [selectedCameraSource, setSelectedCameraSource] = createSignal<MediaDeviceInfo["deviceId"] | undefined>();
	const [microphoneDevices, setMicrophoneMediaDevices] = createSignal<MediaDeviceInfo[]>([]);
	const [selectedMicrophoneSource, setSelectedMicrophoneSource] = createSignal<
		MediaDeviceInfo["deviceId"] | undefined
	>();
	const [cameraActive, setCameraActive] = createSignal<boolean>(false);
	const [screenActive, setScreenActive] = createSignal<boolean>(false);
	const [microphoneActive, setMicrophoneActive] = createSignal<boolean>(false);
	const [nothingActive, setNothingActive] = createSignal<boolean>(false);
	const [publishStatus, setPublishStatus] = createSignal<PublishStatus>("no-url");

	const value: PublishControlsContextValue = {
		hangPublish: props.hangPublish,
		cameraDevices,
		microphoneDevices,
		publishStatus,
		cameraActive,
		screenActive,
		microphoneActive,
		nothingActive,
		selectedCameraSource,
		selectedMicrophoneSource,
	};

	createEffect(() => {
		const hangPublishEl = props.hangPublish();
		if (!hangPublishEl) return;

		if (!hangPublishEl.active) {
			// @ts-ignore ignore custom event - todo add event map
			hangPublishEl.addEventListener("publish-instance-available", (event: CustomEvent) => {
				const publishInstance = event.detail.instance.peek?.() as HangPublishInstance;
				onPublishInstanceAvailable(hangPublishEl, publishInstance);
			});
		} else {
			const publishInstance = hangPublishEl.active.peek?.() as HangPublishInstance;
			onPublishInstanceAvailable(hangPublishEl, publishInstance);
		}
	});

	return <PublishControlsContext.Provider value={value}>{props.children}</PublishControlsContext.Provider>;

	function onPublishInstanceAvailable(el: HangPublish, publishInstance: HangPublishInstance) {
		publishInstance?.signals.effect(function trackCameraDevices(effect) {
			const video = effect.get(publishInstance.video);

			if (!video || !("device" in video)) return;

			const devices = effect.get(video.device.available);

			if (!devices || devices.length < 2) return;

			setCameraMediaDevices(devices);
		});

		publishInstance?.signals.effect(function trackMicrophoneDevices(effect) {
			const audio = effect.get(publishInstance.audio);

			if (!audio || !("device" in audio)) return;

			const enabled = effect.get(publishInstance.broadcast.audio.enabled);
			if (!enabled) return;

			const devices = effect.get(audio.device.available);
			if (!devices || devices.length < 2) return;

			setMicrophoneMediaDevices(devices);
		});

		publishInstance?.signals.effect(function trackNothingSourceActive(effect) {
			const selectedSource = effect.get(el.signals.source);
			setNothingActive(selectedSource === undefined);
		});

		publishInstance?.signals.effect(function trackMicrophoneSourceActive(effect) {
			const audioActive = effect.get(el.signals.audio);
			setMicrophoneActive(audioActive);
		});

		publishInstance?.signals.effect(function trackVideoSourcesActive(effect) {
			const videoSource = effect.get(el.signals.source);
			const videoActive = effect.get(el.signals.video);

			if (videoActive && videoSource === "camera") {
				setCameraActive(true);
				setScreenActive(false);
			} else if (videoActive && videoSource === "screen") {
				setScreenActive(true);
				setCameraActive(false);
			} else {
				setCameraActive(false);
				setScreenActive(false);
			}
		});

		publishInstance?.signals.effect(function trackSelectedCameraSource(effect) {
			const video = effect.get(publishInstance.video);

			if (!video || !("device" in video)) return;

			const requested = effect.get(video.device.requested);
			setSelectedCameraSource(requested);
		});

		publishInstance?.signals.effect(function trackSelectedMicrophoneSource(effect) {
			const audio = effect.get(publishInstance.audio);

			if (!audio || !("device" in audio)) return;

			const requested = effect.get(audio.device.requested);
			setSelectedMicrophoneSource(requested);
		});

		publishInstance?.signals.effect(function trackPublishStatus(effect) {
			const url = effect.get(publishInstance?.connection.url);
			const status = effect.get(publishInstance?.connection.status);
			const audio = effect.get(publishInstance?.broadcast.audio.source);
			const video = effect.get(publishInstance?.broadcast.video.source);

			if (!url) {
				setPublishStatus("no-url");
			} else if (status === "disconnected") {
				setPublishStatus("disconnected");
			} else if (status === "connecting") {
				setPublishStatus("connecting");
			} else if (!audio && !video) {
				setPublishStatus("select-source");
			} else if (!audio && video) {
				setPublishStatus("video-only");
			} else if (audio && !video) {
				setPublishStatus("audio-only");
			} else if (audio && video) {
				setPublishStatus("live");
			}
		});
	}
}
