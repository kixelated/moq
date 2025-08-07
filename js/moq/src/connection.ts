import type { AnnouncedConsumer } from "./announced";
import type { BroadcastConsumer } from "./broadcast";
import * as Ietf from "./ietf";
import * as Lite from "./lite";
import type * as Path from "./path";
import { Stream } from "./stream";

export interface Connection {
	readonly url: URL;

	announced(prefix?: Path.Valid): AnnouncedConsumer;
	publish(name: Path.Valid, broadcast: BroadcastConsumer): void;
	consume(broadcast: Path.Valid): BroadcastConsumer;
	close(): void;
	closed(): Promise<void>;
}

/**
 * Establishes a connection to a MOQ server.
 *
 * @param url - The URL of the server to connect to
 * @returns A promise that resolves to a Connection instance
 */
export async function connect(url: URL): Promise<Connection> {
	const options: WebTransportOptions = {
		allowPooling: false,
		congestionControl: "low-latency",
		requireUnreliable: true,
	};

	const hexToBytes = (hex: string) => {
		hex = hex.startsWith("0x") ? hex.slice(2) : hex;
		if (hex.length % 2) {
			throw new Error("invalid hex string length");
		}

		const matches = hex.match(/.{2}/g);
		if (!matches) {
			throw new Error("invalid hex string format");
		}

		return new Uint8Array(matches.map((byte) => parseInt(byte, 16)));
	};

	let adjustedUrl = url;

	if (url.protocol === "http:") {
		const fingerprintUrl = new URL(url);
		fingerprintUrl.pathname = "/certificate.sha256";
		fingerprintUrl.search = "";
		console.warn(fingerprintUrl.toString(), "performing an insecure fingerprint fetch; use https:// in production");

		// Fetch the fingerprint from the server.
		const fingerprint = await fetch(fingerprintUrl);
		const fingerprintText = await fingerprint.text();

		options.serverCertificateHashes = [
			{
				algorithm: "sha-256",
				value: hexToBytes(fingerprintText),
			},
		];

		adjustedUrl = new URL(url);
		adjustedUrl.protocol = "https:";
	}

	const quic = new WebTransport(adjustedUrl, options);
	await quic.ready;

	const msg = new Lite.SessionClient([Lite.CURRENT_VERSION, Ietf.CURRENT_VERSION]);

	const stream = await Stream.open(quic);

	// We're encoding 0x40 so it's backwards compatible with moq-transport
	await stream.writer.u53(Lite.SteamId.ClientCompat);
	await msg.encode(stream.writer);

	// And we expect 0x41 as the response.
	const serverCompat = await stream.reader.u53();
	if (serverCompat !== Lite.SteamId.ServerCompat) {
		throw new Error(`unsupported server message type: ${serverCompat.toString()}`);
	}

	const server = await Lite.SessionServer.decode(stream.reader);
	if (server.version === Lite.CURRENT_VERSION) {
		return new Lite.Connection(adjustedUrl, quic, stream);
	} else if (server.version === Ietf.CURRENT_VERSION) {
		return new Ietf.Connection(adjustedUrl, quic, stream);
	} else {
		throw new Error(`unsupported server version: ${server.version.toString()}`);
	}
}
