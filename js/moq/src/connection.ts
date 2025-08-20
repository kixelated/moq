import type { AnnouncedConsumer } from "./announced";
import type { BroadcastConsumer } from "./broadcast";
import * as Ietf from "./ietf";
import * as Lite from "./lite";
import type * as Path from "./path";
import { Stream } from "./stream";
import * as Hex from "./util/hex";

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
				value: Hex.toBytes(fingerprintText),
			},
		];

		adjustedUrl = new URL(url);
		adjustedUrl.protocol = "https:";
	}

	const quic = new WebTransport(adjustedUrl, options);
	await quic.ready;

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
		console.debug("moq-lite session established");
		return new Lite.Connection(adjustedUrl, quic, stream);
	} else if (server.version === Ietf.CURRENT_VERSION) {
		console.debug("moq-ietf session established");
		return new Ietf.Connection(adjustedUrl, quic, stream);
	} else {
		throw new Error(`unsupported server version: ${server.version.toString()}`);
	}

}
