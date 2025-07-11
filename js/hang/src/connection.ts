import * as Moq from "@kixelated/moq";
import { type Effect, Root, Signal } from "@kixelated/signals";

export type ConnectionProps = {
	// The URL of the relay server.
	url?: URL;

	// Reload the connection when it disconnects.
	// default: true
	reload?: boolean;

	// The delay in milliseconds before reconnecting.
	// default: 1000
	delay?: DOMHighResTimeStamp;

	// The maximum delay in milliseconds.
	// default: 30000
	maxDelay?: number;
};

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "unsupported";

export class Connection {
	url: Signal<URL | undefined>;
	status = new Signal<ConnectionStatus>("disconnected");
	established = new Signal<Moq.Connection | undefined>(undefined);

	readonly reload: boolean;
	readonly delay: number;
	readonly maxDelay: number;

	#signals = new Root();
	#delay: number;

	// Increased by 1 each time to trigger a reload.
	#tick = new Signal(0);

	constructor(props?: ConnectionProps) {
		this.url = new Signal(props?.url);
		this.reload = props?.reload ?? true;
		this.delay = props?.delay ?? 1000;
		this.maxDelay = props?.maxDelay ?? 30000;

		this.#delay = this.delay;

		if (typeof WebTransport === "undefined") {
			console.warn("WebTransport is not supported");
			this.status.set("unsupported");
			return;
		}

		// Create a reactive root so cleanup is easier.
		this.#signals.effect(this.#connect.bind(this));
	}

	#connect(effect: Effect): void {
		// Will retry when the tick changes.
		effect.get(this.#tick);

		const url = effect.get(this.url);
		if (!url) return;

		this.status.set("connecting");
		effect.cleanup(() => this.status.set("disconnected"));

		(async () => {
			try {
				const connection = await Moq.Connection.connect(url);
				this.established.set(connection);
				this.status.set("connected");

				// Reset the exponential backoff on success.
				this.#delay = this.delay;

				await connection.closed();
			} catch (err) {
				console.warn("connection error:", err);

				this.established.set(undefined);
				this.status.set("disconnected");

				if (!this.reload) return;
				const tick = this.#tick.peek() + 1;

				setTimeout(() => {
					this.#tick.set((prev) => Math.max(prev, tick));
				}, this.#delay);

				// Exponential backoff.
				this.#delay = Math.min(this.#delay * 2, this.maxDelay);
			}
		})();

		effect.cleanup(() => {
			this.established.set((prev) => {
				prev?.close();
				return undefined;
			});
		});
	}

	close() {
		this.#signals.close();
	}
}
