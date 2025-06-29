import type * as Moq from "@kixelated/moq";
import { type Computed, type Effect, Root, Signal } from "@kixelated/signals";
import * as Catalog from "../catalog";
import type { Connection } from "../connection";
import { Audio, type AudioProps } from "./audio";
import { Chat, type ChatProps } from "./chat";
import { Location, type LocationProps } from "./location";
import { Video, type VideoProps } from "./video";

export interface BroadcastProps {
	// Whether to start downloading the broadcast.
	// Defaults to false so you can make sure everything is ready before starting.
	enabled?: boolean;

	// The broadcast path relative to the connection URL.
	// Defaults to ""
	path?: string;

	// You can disable reloading if you want to save a round trip when you know the broadcast is already live.
	reload?: boolean;

	video?: VideoProps;
	audio?: AudioProps;
	location?: LocationProps;
	chat?: ChatProps;
}

// A broadcast that (optionally) reloads automatically when live/offline.
export class Broadcast {
	connection: Connection;

	enabled: Signal<boolean>;
	path: Signal<string>;
	status = new Signal<"offline" | "loading" | "live">("offline");
	user: Computed<Catalog.User | undefined>;

	audio: Audio;
	video: Video;
	location: Location;
	chat: Chat;

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
		this.path = new Signal(props?.path ?? "");
		this.enabled = new Signal(props?.enabled ?? false);
		this.audio = new Audio(this.#broadcast, this.#catalog, props?.audio);
		this.video = new Video(this.#broadcast, this.#catalog, props?.video);
		this.location = new Location(this.#broadcast, this.#catalog, props?.location);
		this.chat = new Chat(this.#broadcast, this.#catalog, props?.chat);
		this.#reload = props?.reload ?? true;

		this.user = this.signals.computed((effect) => effect.get(this.#catalog)?.user);

		this.signals.effect(this.#runActive.bind(this));
		this.signals.effect(this.#runBroadcast.bind(this));
		this.signals.effect(this.#runCatalog.bind(this));
	}

	#runActive(effect: Effect): void {
		if (!effect.get(this.enabled)) return;

		if (!this.#reload) {
			this.#active.set(true);
			effect.cleanup(() => this.#active.set(false));
			return;
		}

		const conn = effect.get(this.connection.established);
		if (!conn) return;

		const path = effect.get(this.path);

		const announced = conn.announced(path);
		effect.cleanup(() => announced.close());

		effect.spawn(async (cancel) => {
			for (;;) {
				const update = await Promise.race([announced.next(), cancel]);

				// We're donezo.
				if (!update) break;

				// Require full equality
				if (update.path !== "") {
					console.warn("ignoring suffix", update.path);
					continue;
				}

				this.#active.set(update.active);
			}
		});
	}

	#runBroadcast(effect: Effect): void {
		const conn = effect.get(this.connection.established);
		if (!conn) return;

		if (!effect.get(this.enabled)) return;

		const path = effect.get(this.path);
		if (!effect.get(this.#active)) return;

		const broadcast = conn.consume(path);
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

				console.debug("received catalog", this.path.peek(), update);

				this.#catalog.set(update);
				this.status.set("live");
			}
		} catch (err) {
			console.warn("error fetching catalog", this.path.peek(), err);
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
	}
}
