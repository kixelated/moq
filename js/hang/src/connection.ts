import type { WebSocketOptions } from "@kixelated/moq";
import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import type * as Time from "./time";

export type ConnectionReloadProps = {
	// Whether to reload the connection when it disconnects.
	// default: true
	enabled?: boolean;

	// The delay in milliseconds before reconnecting.
	// default: 1000
	delay?: Time.Milli;

	// The maximum delay in milliseconds.
	// default: 30000
	maxDelay?: Time.Milli;
};

export type ConnectionProps = {
	// The URL of the relay server.
	url?: URL | Signal<URL | undefined>;

	// Reload the connection when it disconnects.
	reload?: ConnectionReloadProps;

	// WebTransport options.
	webtransport?: WebTransportOptions;

	// WebSocket (fallback) options.
	websocket?: WebSocketOptions;
};

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export class Connection {
	url: Signal<URL | undefined>;
	status = new Signal<ConnectionStatus>("disconnected");
	established = new Signal<Moq.Connection | undefined>(undefined);

	// WebTransport options (not reactive).
	webtransport?: WebTransportOptions;

	// WebSocket (fallback) options (not reactive).
	websocket: WebSocketOptions | undefined;

	// Connection reload options (not reactive).
	reload?: ConnectionReloadProps;

	signals = new Effect();

	#delay: Time.Milli;

	// Increased by 1 each time to trigger a reload.
	#tick = new Signal(0);

	constructor(props?: ConnectionProps) {
		this.url = Signal.from(props?.url);
		this.reload = props?.reload;
		this.webtransport = props?.webtransport;
		this.websocket = props?.websocket;

		this.#delay = this.reload?.delay ?? (1000 as Time.Milli);

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
				const pending = Moq.connect(url, { websocket: this.websocket, webtransport: this.webtransport });

				const connection = await Promise.race([cancel, pending]);
				if (!connection) {
					pending.then((conn) => conn.close()).catch(() => {});
					return;
				}

				effect.set(this.established, connection);
				effect.cleanup(() => connection.close());

				effect.set(this.status, "connected", "disconnected");

				// Reset the exponential backoff on success.
				this.#delay = this.reload?.delay ?? (1000 as Time.Milli);

				await Promise.race([cancel, connection.closed()]);
			} catch (err) {
				console.warn("connection error:", err);

				// Exponential backoff.
				if (this.reload?.enabled !== false) {
					const tick = this.#tick.peek() + 1;

					effect.timer(() => this.#tick.set((prev) => Math.max(prev, tick)), this.#delay);

					// Exponential backoff.
					const maxDelay = this.reload?.maxDelay ?? (30000 as Time.Milli);
					this.#delay = Math.min(this.#delay * 2, maxDelay) as Time.Milli;
				}
			}
		});
	}

	close() {
		this.signals.close();
	}
}
