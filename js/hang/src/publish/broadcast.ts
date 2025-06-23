import * as Moq from "@kixelated/moq";
import { Effect, Root, Signal } from "@kixelated/signals";
import * as Catalog from "../catalog";
import { Connection } from "../connection";
import { isChrome } from "../hacks";
import { Audio, AudioProps, AudioTrack } from "./audio";
import { Chat, ChatProps } from "./chat";
import { Location, LocationProps } from "./location";
import { Video, VideoProps, VideoTrack } from "./video";

export type Device = "screen" | "camera";

export type BroadcastProps = {
	enabled?: boolean;
	path?: string;
	audio?: AudioProps;
	video?: VideoProps;
	location?: LocationProps;
	user?: Catalog.User;
	device?: Device;
	chat?: ChatProps;

	// You can disable reloading if you want to save a round trip when you know the broadcast is already live.
	reload?: boolean;
};

export class Broadcast {
	connection: Connection;
	enabled: Signal<boolean>;
	path: Signal<string>;

	audio: Audio;
	video: Video;
	location: Location;
	user: Signal<Catalog.User | undefined>;
	chat: Chat;

	//catalog: Memo<Catalog.Root>;
	device: Signal<Device | undefined>;

	#broadcast = new Moq.BroadcastProducer();
	#catalog = new Moq.TrackProducer("catalog.json", 0);
	signals = new Root();

	#published = new Signal(false);
	readonly published = this.#published.readonly();

	constructor(connection: Connection, props?: BroadcastProps) {
		this.connection = connection;
		this.enabled = new Signal(props?.enabled ?? false);
		this.path = new Signal(props?.path ?? "");

		this.audio = new Audio(this.#broadcast, props?.audio);
		this.video = new Video(this.#broadcast, props?.video);
		this.location = new Location(this.#broadcast, props?.location);
		this.chat = new Chat(this.#broadcast, props?.chat);
		this.user = new Signal(props?.user);

		this.device = new Signal(props?.device);

		this.#broadcast.insertTrack(this.#catalog.consume());

		this.signals.effect((effect) => {
			if (!effect.get(this.enabled)) return;

			const connection = effect.get(this.connection.established);
			if (!connection) return;

			const path = effect.get(this.path);
			if (path === undefined) return;

			// Publish the broadcast to the connection.
			const consume = this.#broadcast.consume();

			// Unpublish the broadcast by closing the consumer but not the publisher.
			effect.cleanup(() => consume.close());
			connection.publish(path, consume);

			this.#published.set(true);
			effect.cleanup(() => this.#published.set(false));
		});

		// These are separate effects because the camera audio/video constraints can be independent.
		// The screen constraints are needed at the same time.
		this.signals.effect(this.#runCameraAudio.bind(this));
		this.signals.effect(this.#runCameraVideo.bind(this));
		this.signals.effect(this.#runScreen.bind(this));
		this.signals.effect(this.#runCatalog.bind(this));
	}

	#runCameraAudio(effect: Effect): void {
		const device = effect.get(this.device);
		if (device !== "camera") return;

		if (!effect.get(this.audio.enabled)) return;

		const constraints = effect.get(this.audio.constraints) ?? {};

		// Chrome has a long-standing bug where echoCancellation does NOT work with WebAudio.
		// See and bump: https://issues.chromium.org/issues/40504498
		// Unless explicitly requested, we disable it.
		if (isChrome && constraints?.echoCancellation === undefined) {
			constraints.echoCancellation = { exact: false };
		}

		const mediaPromise = navigator.mediaDevices.getUserMedia({ audio: constraints });

		effect.spawn(async (_cancel) => {
			const media = await mediaPromise;
			const track = media.getAudioTracks().at(0) as AudioTrack | undefined;
			effect.cleanup(() => track?.stop());

			this.audio.media.set(track);
			effect.cleanup(() => this.audio.media.set(undefined));
		});
	}

	#runCameraVideo(effect: Effect): void {
		const device = effect.get(this.device);
		if (device !== "camera") return;

		if (!effect.get(this.video.enabled)) return;

		const mediaPromise = navigator.mediaDevices.getUserMedia({ video: effect.get(this.video.constraints) ?? true });

		effect.spawn(async (_cancel) => {
			const media = await mediaPromise;
			const track = media.getVideoTracks().at(0) as VideoTrack | undefined;
			effect.cleanup(() => track?.stop());

			this.video.media.set(track);
			effect.cleanup(() => this.video.media.set(undefined));
		});
	}

	#runScreen(effect: Effect): void {
		const device = effect.get(this.device);
		if (device !== "screen") return;

		if (!effect.get(this.audio.enabled) && !effect.get(this.video.enabled)) return;

		// TODO Expose these to the application.
		// @ts-expect-error Chrome only
		let controller: CaptureController | undefined;
		// @ts-expect-error Chrome only
		if (typeof self.CaptureController !== "undefined") {
			// @ts-expect-error Chrome only
			controller = new CaptureController();
			controller.setFocusBehavior("no-focus-change");
		}

		const mediaPromise = navigator.mediaDevices.getDisplayMedia({
			video: effect.get(this.video.constraints) ?? true,
			audio: effect.get(this.audio.constraints) ?? true,
			// @ts-expect-error Chrome only
			controller,
			preferCurrentTab: false,
			selfBrowserSurface: "exclude",
			surfaceSwitching: "include",
			// TODO We should try to get system audio, but need to be careful about feedback.
			// systemAudio: "exclude",
		});

		effect.spawn(async (_cancel) => {
			const media = await mediaPromise;
			const video = media.getVideoTracks().at(0) as VideoTrack | undefined;
			const audio = media.getAudioTracks().at(0) as AudioTrack | undefined;

			effect.cleanup(() => video?.stop());
			effect.cleanup(() => audio?.stop());

			this.video.media.set(video);
			effect.cleanup(() => this.video.media.set(undefined));

			this.audio.media.set(audio);
			effect.cleanup(() => this.audio.media.set(undefined));
		});
	}

	#runCatalog(effect: Effect): void {
		if (!effect.get(this.enabled)) return;

		// Create the new catalog.
		const audio = effect.get(this.audio.catalog);
		const video = effect.get(this.video.catalog);

		const catalog: Catalog.Root = {
			video: video ? [video] : [],
			audio: audio ? [audio] : [],
			location: effect.get(this.location.catalog),
			user: effect.get(this.user),
			chat: effect.get(this.chat.catalog),
		};

		const encoded = Catalog.encode(catalog);

		// Encode the catalog.
		const catalogGroup = this.#catalog.appendGroup();
		catalogGroup.writeFrame(encoded);
		catalogGroup.close();

		console.debug("published catalog", this.path.peek(), catalog);
	}

	close() {
		this.signals.close();
		this.audio.close();
		this.video.close();
		this.location.close();
		this.chat.close();
	}
}
