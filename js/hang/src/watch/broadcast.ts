import type * as Moq from "@kixelated/moq";
import { type Effect, Root, Signal } from "@kixelated/signals";
import * as Catalog from "../catalog";
import type { Connection } from "../connection";
import { Audio, type AudioProps } from "./audio";
import { Chat, type ChatProps } from "./chat";
import { Location, type LocationProps } from "./location";
import { type PreviewProps, PreviewWatch } from "./preview";
import { Video, type VideoProps } from "./video";

export interface BroadcastProps {
	// Whether to start downloading the broadcast.
	// Defaults to false so you can make sure everything is ready before starting.
	enabled?: boolean;

	// The broadcast name.
	name?: Moq.Path.Valid;

	// You can disable reloading if you want to save a round trip when you know the broadcast is already live.
	reload?: boolean;

	video?: VideoProps;
	audio?: AudioProps;
	location?: LocationProps;
	chat?: ChatProps;
	preview?: PreviewProps;
}

// A broadcast that (optionally) reloads automatically when live/offline.
// TODO rename to Catalog?
export class Broadcast {
	connection: Connection;

	enabled: Signal<boolean>;
	name: Signal<Moq.Path.Valid | undefined>;
	status = new Signal<"offline" | "loading" | "live">("offline");
	user = new Signal<Catalog.User | undefined>(undefined);

	audio: Audio;
	video: Video;
	location: Location;
	chat: Chat;
	preview: PreviewWatch;

	#broadcast = new Signal<Moq.BroadcastConsumer | undefined>(undefined);

	#catalog = new Signal<Catalog.Root | undefined>(undefined);
	readonly catalog = this.#catalog.readonly();

	// This signal is true when the broadcast has been announced, unless reloading is disabled.
	#active = new Signal(false);
	readonly active = this.#active.readonly();

	#reload: boolean;
	signals = new Root();

	constructor(connection: Connection, props?: BroadcastProps) {
		this.connection = connection;
		this.name = new Signal(props?.name);
		this.enabled = new Signal(props?.enabled ?? false);
		this.audio = new Audio(this.#broadcast, this.#catalog, props?.audio);
		this.video = new Video(this.#broadcast, this.#catalog, props?.video);
		this.location = new Location(this.#broadcast, this.#catalog, props?.location);
		this.chat = new Chat(this.#broadcast, this.#catalog, props?.chat);
		this.preview = new PreviewWatch(this.#broadcast, this.#catalog, props?.preview);
		this.#reload = props?.reload ?? true;

		this.signals.effect((effect) => {
			this.user.set(effect.get(this.#catalog)?.user);
		});

		this.signals.effect(this.#runActive.bind(this));
		this.signals.effect(this.#runBroadcast.bind(this));
		this.signals.effect(this.#runCatalog.bind(this));
	}

	#runActive(effect: Effect): void {
		if (!effect.get(this.enabled)) return;

		if (!this.#reload) {
			effect.set(this.#active, true, false);
			return;
		}

		const conn = effect.get(this.connection.established);
		if (!conn) return;

		const name = effect.get(this.name);
		if (!name) return;

		const announced = conn.announced(name);
		effect.cleanup(() => announced.close());

		effect.spawn(async (cancel) => {
			try {
				for (;;) {
					const update = await Promise.race([announced.next(), cancel]);

					// We're donezo.
					if (!update) break;

					// Require full equality
					if (update.name !== "") {
						console.warn("ignoring suffix", update.name);
						continue;
					}

					this.#active.set(update.active);
				}
			} finally {
				this.#active.set(false);
			}
		});
	}

	#runBroadcast(effect: Effect): void {
		const conn = effect.get(this.connection.established);
		if (!conn) return;

		if (!effect.get(this.enabled)) return;

		const name = effect.get(this.name);
		if (!name) return;

		if (!effect.get(this.#active)) return;

		const broadcast = conn.consume(name);
		effect.cleanup(() => broadcast.close());

		this.#broadcast.set(broadcast);
		effect.cleanup(() => this.#broadcast.set(undefined));
	}

	#runCatalog(effect: Effect): void {
		if (!effect.get(this.enabled)) return;

		const broadcast = effect.get(this.#broadcast);
		if (!broadcast) return;

		this.status.set("loading");

		const catalog = broadcast.subscribe("catalog.json", 0);
		effect.cleanup(() => catalog.close());

		effect.spawn(this.#fetchCatalog.bind(this, catalog));
	}

	async #fetchCatalog(catalog: Moq.TrackConsumer, cancel: Promise<void>): Promise<void> {
		try {
			for (;;) {
				const update = await Promise.race([Catalog.fetch(catalog), cancel]);
				if (!update) break;

				console.debug("received catalog", this.name.peek(), update);

				this.#catalog.set(update);
				this.status.set("live");
			}
		} catch (err) {
			console.warn("error fetching catalog", this.name.peek(), err);
		} finally {
			this.#catalog.set(undefined);
			this.status.set("offline");
		}
	}

	close() {
		this.signals.close();

		this.audio.close();
		this.video.close();
		this.location.close();
		this.chat.close();
		this.preview.close();
	}
}
