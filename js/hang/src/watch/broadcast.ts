import * as Moq from "@kixelated/moq";
import { Effect, type Getter, Signal } from "@kixelated/signals";
import * as Catalog from "../catalog";
import * as Audio from "./audio";
import { Chat, type ChatProps } from "./chat";
import * as Location from "./location";
import { Preview, type PreviewProps } from "./preview";
import { PRIORITY } from "./priority";
import * as Video from "./video";
import { Detection, type DetectionProps } from "./video/detection";

export interface BroadcastProps {
	connection?: Moq.Connection | Signal<Moq.Connection | undefined>;

	// Whether to start downloading the broadcast.
	// Defaults to false so you can make sure everything is ready before starting.
	enabled?: boolean | Signal<boolean>;

	// The broadcast name.
	name?: Moq.Path.Valid | Signal<Moq.Path.Valid | undefined>;

	// You can disable reloading if you don't want to wait for an announcement.
	reload?: boolean | Signal<boolean>;

	video?: Video.SourceProps;
	audio?: Audio.SourceProps;
	location?: Location.Props;
	chat?: ChatProps;
	detection?: DetectionProps;
	preview?: PreviewProps;
}

// A broadcast that (optionally) reloads automatically when live/offline.
export class Broadcast {
	connection: Signal<Moq.Connection | undefined>;

	enabled: Signal<boolean>;
	name: Signal<Moq.Path.Valid | undefined>;
	status = new Signal<"offline" | "loading" | "live">("offline");
	user = new Signal<Catalog.User | undefined>(undefined);
	reload: Signal<boolean>;

	audio: Audio.Source;
	video: Video.Source;
	location: Location.Root;
	chat: Chat;
	detection: Detection;
	preview: Preview;

	#broadcast = new Signal<Moq.Broadcast | undefined>(undefined);

	#catalog = new Signal<Catalog.Root | undefined>(undefined);
	readonly catalog: Getter<Catalog.Root | undefined> = this.#catalog;

	// This signal is true when the broadcast has been announced, unless reloading is disabled.
	#active = new Signal(false);
	readonly active: Getter<boolean> = this.#active;

	signals = new Effect();

	constructor(props?: BroadcastProps) {
		this.connection = Signal.from(props?.connection);
		this.name = Signal.from(props?.name);
		this.enabled = Signal.from(props?.enabled ?? false);
		this.reload = Signal.from(props?.reload ?? true);
		this.audio = new Audio.Source(this.#broadcast, this.#catalog, props?.audio);
		this.video = new Video.Source(this.#broadcast, this.#catalog, props?.video);
		this.location = new Location.Root(this.#broadcast, this.#catalog, props?.location);
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

		const conn = effect.get(this.connection);
		if (!conn) return;

		const name = effect.get(this.name);
		if (!name) return;

		const announced = conn.announced(name);
		effect.cleanup(() => announced.close());

		effect.spawn(async () => {
			for (;;) {
				const update = await announced.next();
				if (!update) break;

				// Require full equality
				if (update.name !== name) {
					console.warn("ignoring announce", update.name);
					continue;
				}

				effect.set(this.#active, update.active, false);
			}
		});
	}

	#runBroadcast(effect: Effect): void {
		const conn = effect.get(this.connection);
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

		const catalog = broadcast.subscribe("catalog.json", PRIORITY.catalog);
		effect.cleanup(() => catalog.close());

		effect.spawn(this.#fetchCatalog.bind(this, catalog));
	}

	async #fetchCatalog(catalog: Moq.Track): Promise<void> {
		try {
			for (;;) {
				const update = await Catalog.fetch(catalog);
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
