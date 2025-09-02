import * as Moq from "@kixelated/moq";
import { Effect, type Getter, Signal } from "@kixelated/signals";
import * as Catalog from "../catalog";
import type { Connection } from "../connection";
import { Audio, type AudioProps } from "./audio";
import { Chat, type ChatProps } from "./chat";
import { Location, type LocationProps } from "./location";
import { Preview, type PreviewProps } from "./preview";
import { Video, type VideoProps } from "./video";

export type BroadcastProps = {
	enabled?: boolean | Signal<boolean>;
	name?: Moq.Path.Valid | Signal<Moq.Path.Valid | undefined>;
	audio?: AudioProps;
	video?: VideoProps;
	location?: LocationProps;
	user?: Catalog.User | Signal<Catalog.User | undefined>;
	chat?: ChatProps;
	preview?: PreviewProps;

	// You can disable reloading if you want to save a round trip when you know the broadcast is already live.
	reload?: boolean;
};

export class Broadcast {
	connection: Connection;
	enabled: Signal<boolean>;
	name: Signal<Moq.Path.Valid | undefined>;

	audio: Audio;
	video: Video;

	location: Location;
	user: Signal<Catalog.User | undefined>;
	chat: Chat;

	// TODO should be a separate broadcast for separate authentication.
	preview: Preview;

	//catalog: Memo<Catalog.Root>;

	#broadcast = new Moq.BroadcastProducer();
	#catalog = new Moq.TrackProducer("catalog.json", 0);
	signals = new Effect();

	#published = new Signal(false);
	readonly published: Getter<boolean> = this.#published;

	constructor(connection: Connection, props?: BroadcastProps) {
		this.connection = connection;
		this.enabled = Signal.from(props?.enabled ?? false);
		this.name = Signal.from(props?.name);

		this.audio = new Audio(this.#broadcast, props?.audio);
		this.video = new Video(this.#broadcast, props?.video);
		this.location = new Location(this.#broadcast, props?.location);
		this.chat = new Chat(this.#broadcast, props?.chat);
		this.preview = new Preview(this.#broadcast, props?.preview);
		this.user = Signal.from(props?.user);

		this.#broadcast.insertTrack(this.#catalog.consume());

		this.signals.effect((effect) => {
			if (!effect.get(this.enabled)) return;

			const connection = effect.get(this.connection.established);
			if (!connection) return;

			const name = effect.get(this.name);
			if (!name) return;

			// Publish the broadcast to the connection.
			const consume = this.#broadcast.consume();

			// Unpublish the broadcast by closing the consumer but not the publisher.
			effect.cleanup(() => consume.close());
			connection.publish(name, consume);

			effect.set(this.#published, true, false);
		});

		// These are separate effects because the camera audio/video constraints can be independent.
		// The screen constraints are needed at the same time.
		//this.signals.effect(this.#runScreen.bind(this));
		this.signals.effect(this.#runCatalog.bind(this));
	}

	/*
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
			const video = media.getVideoTracks().at(0) as VideoStreamTrack | undefined;
			const audio = media.getAudioTracks().at(0) as AudioStreamTrack | undefined;

			effect.cleanup(() => video?.stop());
			effect.cleanup(() => audio?.stop());
			effect.set(this.video.media, video);
			effect.set(this.audio.media, audio);
		});
	}
	*/

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
			detection: effect.get(this.video.detection.catalog),
		};

		const encoded = Catalog.encode(catalog);

		// Encode the catalog.
		const catalogGroup = this.#catalog.appendGroup();
		catalogGroup.writeFrame(encoded);
		catalogGroup.close();

		console.debug("published catalog", this.name.peek(), catalog);
	}

	close() {
		this.signals.close();
		this.audio.close();
		this.video.close();
		this.location.close();
		this.chat.close();
	}
}
