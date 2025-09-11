import WebTransportWs from "@kixelated/web-transport-ws";
import type { AnnouncedConsumer } from "./announced";
import type { BroadcastConsumer } from "./broadcast";
import * as Ietf from "./ietf";
import * as Lite from "./lite";
import type * as Path from "./path";
import { Stream } from "./stream";
import * as Hex from "./util/hex";

// Both moq-lite and moq-ietf implement this.
export interface Connection {
	readonly url: URL;

	announced(prefix?: Path.Valid): AnnouncedConsumer;
	publish(name: Path.Valid, broadcast: BroadcastConsumer): void;
	consume(broadcast: Path.Valid): BroadcastConsumer;
	close(): void;
	closed(): Promise<void>;
}

export interface WebSocketOptions {
	// If true (default), enable the WebSocket fallback.
	enabled?: boolean;

	// Optional: Use a different URL than WebTransport.
	// By default, `https` => `wss` and `http` => `ws`.
	url?: URL;

	// The delay in milliseconds before attempting the WebSocket fallback. (default: 200)
	// If WebSocket won the previous race for a given URL, this will be 0.
	delay?: DOMHighResTimeStamp;
}

export interface ConnectionProps {
	// WebTransport options.
	webtransport?: WebTransportOptions;

	// WebSocket (fallback) options.
	websocket?: WebSocketOptions;
}

// Save if WebSocket won the last race, so we won't give QUIC a head start next time.
const websocketWon = new Map<string, boolean>();

/**
 * Establishes a connection to a MOQ server.
 *
 * @param url - The URL of the server to connect to
 * @returns A promise that resolves to a Connection instance
 */
export async function connect(url: URL, props?: ConnectionProps): Promise<Connection> {
	// Create a cancel promise to kill whichever is still connecting.
	let done: (() => void) | undefined;
	const cancel = new Promise<void>((resolve) => {
		done = resolve;
	});

	const webtransport = globalThis.WebTransport ? connectWebTransport(url, cancel, props?.webtransport) : undefined;

	// Give QUIC a 200ms head start to connect before trying WebSocket, unless WebSocket has won in the past.
	// NOTE that QUIC should be faster because it involves 1/2 fewer RTTs.
	const headstart = !webtransport || websocketWon.get(url.toString()) ? 0 : (props?.websocket?.delay ?? 200);
	const websocket =
		props?.websocket?.enabled !== false
			? connectWebSocket(props?.websocket?.url ?? url, headstart, cancel)
			: undefined;

	if (!websocket && !webtransport) {
		throw new Error("no transport available; WebTransport not supported and WebSocket is disabled");
	}

	// Race them, using `.any` to ignore if one participant has a error.
	const quic = await Promise.any(
		webtransport ? (websocket ? [websocket, webtransport] : [webtransport]) : [websocket],
	);
	if (done) done();

	if (!quic) throw new Error("no transport available");

	// Save if WebSocket won the last race, so we won't give QUIC a head start next time.
	if (quic instanceof WebTransportWs) {
		console.warn(url.toString(), "using WebSocket fallback; the user experience may be degraded");
		websocketWon.set(url.toString(), true);
	}

	// moq-rs currently requires the ROLE extension to be set.
	const extensions = new Lite.Extensions();
	extensions.set(0x0n, new Uint8Array([0x03]));

	const msg = new Lite.SessionClient([Lite.CURRENT_VERSION, Ietf.CURRENT_VERSION], extensions);
	const stream = await Stream.open(quic);

	// We're encoding 0x40 so it's backwards compatible with moq-transport
	await stream.writer.u53(Lite.StreamId.ClientCompat);
	await msg.encode(stream.writer);

	// And we expect 0x41 as the response.
	const serverCompat = await stream.reader.u53();
	if (serverCompat !== Lite.StreamId.ServerCompat) {
		throw new Error(`unsupported server message type: ${serverCompat.toString()}`);
	}

	const server = await Lite.SessionServer.decode(stream.reader);
	if (server.version === Lite.CURRENT_VERSION) {
		console.debug(url.toString(), "moq-lite session established");
		return new Lite.Connection(url, quic, stream);
	} else if (server.version === Ietf.CURRENT_VERSION) {
		console.debug(url.toString(), "moq-ietf session established");
		return new Ietf.Connection(url, quic, stream);
	} else {
		throw new Error(`unsupported server version: ${server.version.toString()}`);
	}
}

async function connectWebTransport(
	url: URL,
	cancel: Promise<void>,
	options?: WebTransportOptions,
): Promise<WebTransport | undefined> {
	let finalUrl = url;

	const finalOptions: WebTransportOptions = {
		allowPooling: false,
		congestionControl: "low-latency",
		...options,
	};

	// Only perform certificate fetch and URL rewrite when polyfill is not needed
	// This is needed because WebTransport is a butt to work with in local development.
	if (url.protocol === "http:") {
		const fingerprintUrl = new URL(url);
		fingerprintUrl.pathname = "/certificate.sha256";
		fingerprintUrl.search = "";
		console.warn(fingerprintUrl.toString(), "performing an insecure fingerprint fetch; use https:// in production");

		// Fetch the fingerprint from the server.
		const fingerprint = await Promise.race([fetch(fingerprintUrl), cancel]);
		if (!fingerprint) return undefined;

		const fingerprintText = await Promise.race([fingerprint.text(), cancel]);
		if (fingerprintText === undefined) return undefined;

		finalOptions.serverCertificateHashes = (finalOptions.serverCertificateHashes || []).concat([
			{
				algorithm: "sha-256",
				value: Hex.toBytes(fingerprintText),
			},
		]);

		finalUrl = new URL(url);
		finalUrl.protocol = "https:";
	}

	const quic = new WebTransport(finalUrl, finalOptions);

	// Wait for the WebTransport to connect, or for the cancel promise to resolve.
	// Close the connection if we lost the race.
	const loaded = await Promise.race([quic.ready.then(() => true), cancel]);
	if (!loaded) {
		quic.close();
		return undefined;
	}

	return quic;
}

// TODO accept arguments to control the port/path used.
async function connectWebSocket(url: URL, delay: number, cancel: Promise<void>): Promise<WebTransport | undefined> {
	const timer = new Promise<void>((resolve) => setTimeout(resolve, delay));

	const active = await Promise.race([cancel, timer.then(() => true)]);
	if (!active) return undefined;

	if (delay) {
		console.debug(url.toString(), `no WebTransport after ${delay}ms, attempting WebSocket fallback`);
	}

	const quic = new WebTransportWs(url);

	// Wait for the WebSocket to connect, or for the cancel promise to resolve.
	// Close the connection if we lost the race.
	const loaded = await Promise.race([quic.ready.then(() => true), cancel]);
	if (!loaded) {
		quic.close();
		return undefined;
	}

	return quic;
}
