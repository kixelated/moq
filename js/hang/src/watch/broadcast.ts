import * as Moq from "@kixelated/moq";
import { Memo, Signal, Signals, cleanup, signal } from "@kixelated/signals";
import * as Catalog from "../catalog";
import { Connection } from "../connection";
import { Audio, AudioProps } from "./audio";
import { Chat, ChatProps } from "./chat";
import { Location, LocationProps } from "./location";
import { Video, VideoProps } from "./video";

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
	status = signal<"offline" | "loading" | "live">("offline");
	user: Memo<Catalog.User | undefined>;

	audio: Audio;
	video: Video;
	location: Location;
	chat: Chat;

	#broadcast = signal<Moq.BroadcastConsumer | undefined>(undefined);

	#catalog = signal<Catalog.Root | undefined>(undefined);
	readonly catalog = this.#catalog.readonly();

	// This signal is true when the broadcast has been announced, unless reloading is disabled.
	#active = signal(false);
	readonly active = this.#active.readonly();

	#reload: boolean;
	signals = new Signals();

	constructor(connection: Connection, props?: BroadcastProps) {
		this.connection = connection;
		this.path = signal(props?.path ?? "");
		this.enabled = signal(props?.enabled ?? false);
		this.audio = new Audio(this.#broadcast, this.#catalog, props?.audio);
		this.video = new Video(this.#broadcast, this.#catalog, props?.video);
		this.location = new Location(this.#broadcast, this.#catalog, props?.location);
		this.chat = new Chat(this.#broadcast, this.#catalog, props?.chat);
		this.#reload = props?.reload ?? true;

		this.user = this.signals.memo(() => this.#catalog.get()?.user);

		this.signals.effect(() => this.#runActive());
		this.signals.effect(() => this.#runBroadcast());
		this.signals.effect(() => this.#runCatalog());
	}

	#runActive(): void {
		if (!this.enabled.get()) return;

		if (!this.#reload) {
			this.#active.set(true);
			cleanup(() => this.#active.set(false));
			return;
		}

		const conn = this.connection.established.get();
		if (!conn) return;

		const path = this.path.get();

		const announced = conn.announced(path);
		cleanup(() => announced.close());

		(async () => {
			for (;;) {
				const update = await announced.next();

				// We're donezo.
				if (!update) break;

				// Require full equality
				if (update.path !== "") {
					console.warn("ignoring suffix", update.path);
					continue;
				}

				this.#active.set(update.active);
			}
		})();
	}

	#runBroadcast(): void {
		const conn = this.connection.established.get();
		if (!conn) return;

		if (!this.enabled.get()) return;

		const path = this.path.get();
		if (!this.#active.get()) return;

		const broadcast = conn.consume(path);
		cleanup(() => broadcast.close());

		this.#broadcast.set(broadcast);
		cleanup(() => this.#broadcast.set(undefined));
	}

	#runCatalog(): void {
		if (!this.enabled.get()) return;

		const broadcast = this.#broadcast.get();
		if (!broadcast) return;

		this.status.set("loading");

		const catalog = broadcast.subscribe("catalog.json", 0);
		cleanup(() => catalog.close());

		(async () => {
			try {
				for (;;) {
					const update = await Catalog.fetch(catalog);
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
		})();
	}

	close() {
		this.signals.close();

		this.audio.close();
		this.video.close();
		this.location.close();
		this.chat.close();
	}
}
