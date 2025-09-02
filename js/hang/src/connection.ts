import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";

export type ConnectionProps = {
	// The URL of the relay server.
	url?: URL | Signal<URL | undefined>;

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

	signals = new Effect();
	#delay: number;

	// Increased by 1 each time to trigger a reload.
	#tick = new Signal(0);

	constructor(props?: ConnectionProps) {
		this.url = Signal.from(props?.url);
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
		this.signals.effect(this.#connect.bind(this));
	}

	#connect(effect: Effect): void {
		// Will retry when the tick changes.
		effect.get(this.#tick);

		const url = effect.get(this.url);
		if (!url) return;

		effect.set(this.status, "connecting", "disconnected");

		effect.spawn(async (cancel) => {
			try {
				const pending = Moq.connect(url);

				const connection = await Promise.race([cancel, pending]);
				if (!connection) {
					pending.then((conn) => conn.close()).catch(() => {});
					return;
				}

				effect.set(this.established, connection);
				effect.cleanup(() => connection.close());

				effect.set(this.status, "connected", "disconnected");

				// Reset the exponential backoff on success.
				this.#delay = this.delay;

				await Promise.race([cancel, connection.closed()]);
			} catch (err) {
				console.warn("connection error:", err);

				// Exponential backoff.
				if (this.reload) {
					const tick = this.#tick.peek() + 1;

					effect.timer(() => this.#tick.set((prev) => Math.max(prev, tick)), this.#delay);

					// Exponential backoff.
					this.#delay = Math.min(this.#delay * 2, this.maxDelay);
				}
			}
		});
	}

	close() {
		this.signals.close();
	}
}
