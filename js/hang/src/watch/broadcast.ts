import type * as Moq from "@kixelated/moq";
import { Effect, type Getter, Signal } from "@kixelated/signals";
import * as Catalog from "../catalog";
import type { Connection } from "../connection";
import { Audio, type AudioProps } from "./audio";
import { Chat, type ChatProps } from "./chat";
import { Location, type LocationProps } from "./location";
import { Preview, type PreviewProps } from "./preview";
import { Video, type VideoProps } from "./video";
import { Detection, type DetectionProps } from "./video/detection";

export interface BroadcastProps {
	// Whether to start downloading the broadcast.
	// Defaults to false so you can make sure everything is ready before starting.
	enabled?: boolean;

	// The broadcast name.
	name?: Moq.Path.Valid;

	// You can disable reloading if you don't want to wait for an announcement.
	reload?: boolean;

	video?: VideoProps;
	audio?: AudioProps;
	location?: LocationProps;
	chat?: ChatProps;
	detection?: DetectionProps;
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
	reload: Signal<boolean>;

	audio: Audio;
	video: Video;
	location: Location;
	chat: Chat;
	detection: Detection;
	preview: Preview;

	#broadcast = new Signal<Moq.BroadcastConsumer | undefined>(undefined);

	#catalog = new Signal<Catalog.Root | undefined>(undefined);
	readonly catalog: Getter<Catalog.Root | undefined> = this.#catalog;

	// This signal is true when the broadcast has been announced, unless reloading is disabled.
	#active = new Signal(false);
	readonly active: Getter<boolean> = this.#active;

	signals = new Effect();

	constructor(connection: Connection, props?: BroadcastProps) {
		this.connection = connection;
		this.name = new Signal(props?.name);
		this.enabled = new Signal(props?.enabled ?? false);
		this.reload = new Signal(props?.reload ?? true);
		this.audio = new Audio(this.#broadcast, this.#catalog, props?.audio);
		this.video = new Video(this.#broadcast, this.#catalog, props?.video);
		this.location = new Location(this.#broadcast, this.#catalog, props?.location);
		this.chat = new Chat(this.#broadcast, this.#catalog, props?.chat);
		this.detection = new Detection(this.#broadcast, this.#catalog, props?.detection);
		this.preview = new Preview(this.#broadcast, this.#catalog, props?.preview);

		this.signals.effect((effect) => {
			this.user.set(effect.get(this.#catalog)?.user);
		});

		this.signals.effect(this.#runReload.bind(this));
		this.signals.effect(this.#runBroadcast.bind(this));
		this.signals.effect(this.#runCatalog.bind(this));
	}

	#runReload(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const reload = effect.get(this.reload);
		if (!reload) {
			// Mark as active without waiting for an announcement.
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
			for (;;) {
				const update = await Promise.race([announced.next(), cancel]);

				// We're donezo.
				if (!update) break;

				// Require full equality
				if (update.name !== "") {
					console.warn("ignoring suffix", update.name);
					continue;
				}

				effect.set(this.#active, update.active, false);
			}
		});
	}

	#runBroadcast(effect: Effect): void {
		const conn = effect.get(this.connection.established);
		const enabled = effect.get(this.enabled);
		const name = effect.get(this.name);
		const active = effect.get(this.#active);
		if (!conn || !enabled || !name || !active) return;

		const broadcast = conn.consume(name);
		effect.cleanup(() => broadcast.close());

		effect.set(this.#broadcast, broadcast);
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
		this.detection.close();
		this.preview.close();
	}
}
