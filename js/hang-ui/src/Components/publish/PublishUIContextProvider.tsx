import type HangPublish from "@kixelated/hang/publish/element";
import type { HangPublishInstance, InstanceAvailableEvent } from "@kixelated/hang/publish/element";
import type { JSX } from "solid-js";
import { createContext, createEffect, createSignal, onCleanup } from "solid-js";

type PublishStatus = "no-url" | "disconnected" | "connecting" | "live" | "audio-only" | "video-only" | "select-source";

type PublishUIContextValue = {
	hangPublish: () => HangPublish | undefined;
	cameraDevices: () => MediaDeviceInfo[];
	microphoneDevices: () => MediaDeviceInfo[];
	publishStatus: () => PublishStatus;
	microphoneActive: () => boolean;
	cameraActive?: () => boolean;
	screenActive?: () => boolean;
	fileActive?: () => boolean;
	nothingActive?: () => boolean;
	selectedCameraSource?: () => MediaDeviceInfo["deviceId"] | undefined;
	selectedMicrophoneSource?: () => MediaDeviceInfo["deviceId"] | undefined;
	setFile: (file: File) => void;
};

type PublishUIContextProviderProps = {
	hangPublish: () => HangPublish | undefined;
	children: JSX.Element;
};

export const PublishUIContext = createContext<PublishUIContextValue>();

export default function PublishUIContextProvider(props: PublishUIContextProviderProps) {
	const [cameraDevices, setCameraMediaDevices] = createSignal<MediaDeviceInfo[]>([]);
	const [selectedCameraSource, setSelectedCameraSource] = createSignal<MediaDeviceInfo["deviceId"] | undefined>();
	const [microphoneDevices, setMicrophoneMediaDevices] = createSignal<MediaDeviceInfo[]>([]);
	const [selectedMicrophoneSource, setSelectedMicrophoneSource] = createSignal<
		MediaDeviceInfo["deviceId"] | undefined
	>();
	const [cameraActive, setCameraActive] = createSignal<boolean>(false);
	const [screenActive, setScreenActive] = createSignal<boolean>(false);
	const [microphoneActive, setMicrophoneActive] = createSignal<boolean>(false);
	const [fileActive, setFileActive] = createSignal<boolean>(false);
	const [nothingActive, setNothingActive] = createSignal<boolean>(false);
	const [publishStatus, setPublishStatus] = createSignal<PublishStatus>("no-url");

	const setFile = (file: File) => {
		const hangPublishEl = props.hangPublish();
		if (!hangPublishEl) return;

		hangPublishEl.file = file;
		hangPublishEl.source = "file";
		hangPublishEl.video = true;
		hangPublishEl.audio = true;
	};

	const value: PublishUIContextValue = {
		hangPublish: props.hangPublish,
		cameraDevices,
		microphoneDevices,
		publishStatus,
		cameraActive,
		screenActive,
		microphoneActive,
		fileActive,
		setFile,
		nothingActive,
		selectedCameraSource,
		selectedMicrophoneSource,
	};

	createEffect(() => {
		const hangPublishEl = props.hangPublish();
		if (!hangPublishEl) return;

		const onInstanceAvailable = (event: InstanceAvailableEvent) => {
			const publishInstance = event.detail.instance.peek?.();

			if (publishInstance) {
				onPublishInstanceAvailable(hangPublishEl, publishInstance);
			}
		};

		const hangPublishInstance = hangPublishEl?.active?.peek?.();

		if (hangPublishInstance) {
			onPublishInstanceAvailable(hangPublishEl, hangPublishInstance);
		} else {
			hangPublishEl.addEventListener("publish-instance-available", onInstanceAvailable);
			onCleanup(() => {
				hangPublishEl.removeEventListener("publish-instance-available", onInstanceAvailable);
			});
		}
	});

	return <PublishUIContext.Provider value={value}>{props.children}</PublishUIContext.Provider>;

	function onPublishInstanceAvailable(el: HangPublish, publishInstance: HangPublishInstance) {
		publishInstance.signals.effect(function trackCameraDevices(effect) {
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

		publishInstance?.signals.effect(function trackFileActive(effect) {
			const selectedSource = effect.get(el.signals.source);
			setFileActive(selectedSource === "file");
		});
	}
}
