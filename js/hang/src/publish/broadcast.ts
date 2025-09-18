import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import * as Catalog from "../catalog";
import * as Audio from "./audio";
import * as Chat from "./chat";
import * as Location from "./location";
import { Preview, type PreviewProps } from "./preview";
import * as User from "./user";
import * as Video from "./video";

export type BroadcastProps = {
	connection?: Moq.Connection.Established | Signal<Moq.Connection.Established | undefined>;
	enabled?: boolean | Signal<boolean>;
	name?: Moq.Path.Valid | Signal<Moq.Path.Valid | undefined>;
	audio?: Audio.EncoderProps;
	video?: Video.EncoderProps;
	location?: Location.Props;
	user?: User.Props;
	chat?: Chat.Props;
	preview?: PreviewProps;
};

export class Broadcast {
	static readonly CATALOG_TRACK = "catalog.json";

	connection: Signal<Moq.Connection.Established | undefined>;
	enabled: Signal<boolean>;
	name: Signal<Moq.Path.Valid | undefined>;

	audio: Audio.Encoder;
	video: Video.Encoder;

	location: Location.Root;
	chat: Chat.Root;
	preview: Preview;
	user: User.Info;

	signals = new Effect();

	constructor(props?: BroadcastProps) {
		this.connection = Signal.from(props?.connection);
		this.enabled = Signal.from(props?.enabled ?? false);
		this.name = Signal.from(props?.name);

		this.audio = new Audio.Encoder(props?.audio);
		this.video = new Video.Encoder(props?.video);
		this.location = new Location.Root(props?.location);
		this.chat = new Chat.Root(props?.chat);
		this.preview = new Preview(props?.preview);
		this.user = new User.Info(props?.user);

		this.signals.effect(this.#run.bind(this));
	}

	#run(effect: Effect) {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const connection = effect.get(this.connection);
		if (!connection) return;

		const name = effect.get(this.name);
		if (name === undefined) return;

		const broadcast = new Moq.Broadcast();
		effect.cleanup(() => broadcast.close());

		connection.publish(name, broadcast);

		effect.spawn(this.#runBroadcast.bind(this, broadcast, effect));
	}

	async #runBroadcast(broadcast: Moq.Broadcast, effect: Effect) {
		for (;;) {
			const request = await broadcast.requested();
			if (!request) break;

			effect.cleanup(() => request.track.close());

			effect.effect((effect) => {
				if (effect.get(request.track.state.closed)) return;

				switch (request.track.name) {
					case Broadcast.CATALOG_TRACK:
						this.#serveCatalog(request.track, effect);
						break;
					case Location.Window.TRACK:
						this.location.window.serve(request.track, effect);
						break;
					case Location.Peers.TRACK:
						this.location.peers.serve(request.track, effect);
						break;
					case Preview.TRACK:
						this.preview.serve(request.track, effect);
						break;
					case Chat.Typing.TRACK:
						this.chat.typing.serve(request.track, effect);
						break;
					case Chat.Message.TRACK:
						this.chat.message.serve(request.track, effect);
						break;
					case Video.Detection.TRACK:
						this.video.detection.serve(request.track, effect);
						break;
					case Audio.Encoder.TRACK:
						this.audio.serve(request.track, effect);
						break;
					case Audio.Speaking.TRACK:
						this.audio.speaking.serve(request.track, effect);
						break;
					case Video.Encoder.TRACK:
						this.video.serve(request.track, effect);
						break;
					default:
						console.warn("received subscription for unknown track", request.track.name);
						request.track.close(new Error(`Unknown track: ${request.track.name}`));
						break;
				}
			});
		}
	}

	#serveCatalog(track: Moq.Track, effect: Effect): void {
		if (!effect.get(this.enabled)) {
			// Clear the catalog.
			track.writeFrame(Catalog.encode({}));
			return;
		}

		// Create the new catalog.
		const audio = effect.get(this.audio.catalog);
		const video = effect.get(this.video.catalog);

		const catalog: Catalog.Root = {
			video: video ? [video] : [],
			audio: audio ? [audio] : [],
			location: effect.get(this.location.catalog),
			user: effect.get(this.user.catalog),
			chat: effect.get(this.chat.catalog),
			detection: effect.get(this.video.detection.catalog),
			preview: effect.get(this.preview.catalog),
		};

		const encoded = Catalog.encode(catalog);
		track.writeFrame(encoded);
	}

	close() {
		this.signals.close();
		this.audio.close();
		this.video.close();
		this.location.close();
		this.chat.close();
		this.preview.close();
		this.user.close();
	}
}
