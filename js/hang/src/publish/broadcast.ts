import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import * as Catalog from "../catalog";
import type { Connection } from "../connection";
import * as Audio from "./audio";
import * as Chat from "./chat";
import { Location, type LocationProps } from "./location";
import { Preview, type PreviewProps } from "./preview";
import * as Video from "./video";
import { TRACKS } from "./tracks";

export type BroadcastProps = {
	enabled?: boolean | Signal<boolean>;
	name?: Moq.Path.Valid | Signal<Moq.Path.Valid | undefined>;
	audio?: Audio.EncoderProps;
	video?: Video.EncoderProps;
	location?: LocationProps;
	user?: Catalog.User | Signal<Catalog.User | undefined>;
	chat?: Chat.Props;
	preview?: PreviewProps;

	// You can disable reloading if you want to save a round trip when you know the broadcast is already live.
	reload?: boolean;
};

export class Broadcast {
	connection: Connection;
	enabled: Signal<boolean>;
	name: Signal<Moq.Path.Valid | undefined>;

	audio: Audio.Encoder;
	video: Video.Encoder;

	location: Location;
	user: Signal<Catalog.User | undefined>;
	chat: Chat.Root;

	// TODO should be a separate broadcast for separate authentication.
	preview: Preview;

	signals = new Effect();

	constructor(connection: Connection, props?: BroadcastProps) {
		this.connection = connection;
		this.enabled = Signal.from(props?.enabled ?? false);
		this.name = Signal.from(props?.name);

		this.audio = new Audio.Encoder(props?.audio);
		this.video = new Video.Encoder(props?.video);
		this.location = new Location(props?.location);
		this.chat = new Chat.Root(props?.chat);
		this.preview = new Preview(props?.preview);
		this.user = Signal.from(props?.user);

		this.signals.spawn(this.#runBroadcast.bind(this, this.signals)); // TODO pass effect to spawn
	}

	async #runBroadcast(effect: Effect): Promise<void> {
		if (!effect.get(this.enabled)) return;

		const connection = effect.get(this.connection.established);
		if (!connection) return;

		const name = effect.get(this.name);
		if (!name) return;

		const broadcast = new Moq.Broadcast();
		effect.cleanup(() => broadcast.close());

		connection.publish(name, broadcast);

		for (;;) {
			const request = await broadcast.requested();
			if (!request) break;

			effect.cleanup(() => request.track.close());

			effect.effect((effect) => {
				if (!effect.get(request.track.state.closed)) return;

				switch (request.track.name) {
					case TRACKS.catalog:
						this.#serveCatalog(request.track, effect);
						break;
					case TRACKS.location:
						this.location.serve(request.track, effect);
						break;
					case TRACKS.preview:
						this.preview.serve(request.track, effect);
						break;
					case TRACKS.typing:
						this.chat.typing.serve(request.track, effect);
						break;
					case TRACKS.chat:
						this.chat.message.serve(request.track, effect);
						break;
					case TRACKS.detection:
						this.video.detection.serve(request.track, effect);
						break;
					case TRACKS.audio:
						this.audio.serve(request.track, effect);
						break;
					case TRACKS.video:
						this.video.serve(request.track, effect);
						break;
					default:
						request.track.close(new Error(`Unknown track: ${request.track.name}`));
						break;
				}
			});
		}
	}

	#serveCatalog(track: Moq.Track, effect: Effect): void {
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
		const catalogGroup = track.appendGroup();
		catalogGroup.writeFrame(encoded);
		catalogGroup.close();
	}

	close() {
		this.signals.close();
		this.audio.close();
		this.video.close();
		this.location.close();
		this.chat.close();
	}
}
