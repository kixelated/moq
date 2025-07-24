import type { AnnouncedConsumer } from "./announced";
import type { BroadcastConsumer } from "./broadcast";
import * as Lite from "./lite";
import * as Path from "./path";
import { Publisher } from "./publisher";
import { type Reader, Readers, Stream } from "./stream";
import { Subscriber } from "./subscriber";

/**
 * Represents a connection to a MoQ server.
 *
 * @public
 */
export class Connection {
	// The URL of the connection.
	readonly url: URL;

	// The established WebTransport session.
	#quic: WebTransport;

	// Use to receive/send session messages.
	#session: Stream;

	// Module for contributing tracks.
	#publisher: Publisher;

	// Module for distributing tracks.
	#subscriber: Subscriber;

	/**
	 * Creates a new Connection instance.
	 * @param url - The URL of the connection
	 * @param quic - The WebTransport session
	 * @param session - The session stream
	 *
	 * @internal
	 */
	private constructor(url: URL, quic: WebTransport, session: Stream) {
		this.url = url;
		this.#quic = quic;
		this.#session = session;

		this.#publisher = new Publisher(this.#quic);
		this.#subscriber = new Subscriber(this.#quic);

		this.#run();
	}

	/**
	 * Establishes a connection to a MOQ server.
	 *
	 * @param url - The URL of the server to connect to
	 * @returns A promise that resolves to a Connection instance
	 */
	static async connect(url: URL): Promise<Connection> {
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
			console.warn(
				fingerprintUrl.toString(),
				"performing an insecure fingerprint fetch; use https:// in production",
			);

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

		const msg = new Lite.SessionClient([Lite.CURRENT_VERSION]);

		const stream = await Stream.open(quic);
		await stream.writer.u8(Lite.SessionClient.StreamID);
		await msg.encode(stream.writer);
		stream.writer.close();

		const server = await Lite.SessionServer.decode(stream.reader);
		if (server.version !== Lite.CURRENT_VERSION) {
			throw new Error(`unsupported server version: ${server.version.toString()}`);
		}

		const conn = new Connection(adjustedUrl, quic, stream);

		// The connection is now ready to use
		// Note: ANNOUNCE_INIT will be handled when announce streams are actually requested

		const cleanup = () => {
			conn.close();
		};

		// Attempt to close the connection when the window is closed.
		document.addEventListener("pagehide", cleanup);
		void conn.closed().then(() => {
			document.removeEventListener("pagehide", cleanup);
		});

		return conn;
	}

	/**
	 * Closes the connection.
	 */
	close() {
		try {
			this.#quic.close();
		} catch {
			// ignore
		}
	}

	async #run(): Promise<void> {
		const session = this.#runSession();
		const bidis = this.#runBidis();
		const unis = this.#runUnis();

		try {
			await Promise.all([session, bidis, unis]);
		} catch (err) {
			console.error("fatal error running connection", err);
		} finally {
			this.close();
		}
	}

	/**
	 * Publishes a broadcast to the connection.
	 * @param name - The broadcast path to publish
	 * @param broadcast - The broadcast to publish
	 */
	publish(name: Path.Valid, broadcast: BroadcastConsumer) {
		this.#publisher.publish(name, broadcast);
	}

	/**
	 * Gets an announced reader for the specified prefix.
	 * @param prefix - The prefix for announcements
	 * @returns An AnnounceConsumer instance
	 */
	announced(prefix = Path.empty()): AnnouncedConsumer {
		return this.#subscriber.announced(prefix);
	}

	/**
	 * Consumes a broadcast from the connection.
	 *
	 * @remarks
	 * If the broadcast is not found, a "not found" error will be thrown when requesting any tracks.
	 *
	 * @param broadcast - The path of the broadcast to consume
	 * @returns A BroadcastConsumer instance
	 */
	consume(broadcast: Path.Valid): BroadcastConsumer {
		return this.#subscriber.consume(broadcast);
	}

	async #runSession() {
		// Receive messages until the connection is closed.
		for (;;) {
			const msg = await Lite.SessionInfo.decode_maybe(this.#session.reader);
			if (!msg) break;
			// TODO use the session info
		}
	}

	async #runBidis() {
		for (;;) {
			const stream = await Stream.accept(this.#quic);
			if (!stream) {
				break;
			}

			this.#runBidi(stream)
				.catch((err: unknown) => {
					stream.writer.reset(err);
				})
				.finally(() => {
					stream.writer.close();
				});
		}
	}

	async #runBidi(stream: Stream) {
		const typ = await stream.reader.u8();

		if (typ === Lite.SessionClient.StreamID) {
			throw new Error("duplicate session stream");
		} else if (typ === Lite.AnnounceInterest.StreamID) {
			const msg = await Lite.AnnounceInterest.decode(stream.reader);
			await this.#publisher.runAnnounce(msg, stream);
			return;
		} else if (typ === Lite.Subscribe.StreamID) {
			const msg = await Lite.Subscribe.decode(stream.reader);
			await this.#publisher.runSubscribe(msg, stream);
			return;
		} else {
			throw new Error(`unknown stream type: ${typ.toString()}`);
		}
	}

	async #runUnis() {
		const readers = new Readers(this.#quic);

		for (;;) {
			const stream = await readers.next();
			if (!stream) {
				break;
			}

			this.#runUni(stream)
				.then(() => {
					stream.stop(new Error("cancel"));
				})
				.catch((err: unknown) => {
					stream.stop(err);
				});
		}
	}

	async #runUni(stream: Reader) {
		const typ = await stream.u8();
		if (typ === Lite.Group.StreamID) {
			const msg = await Lite.Group.decode(stream);
			await this.#subscriber.runGroup(msg, stream);
		} else {
			throw new Error(`unknown stream type: ${typ.toString()}`);
		}
	}

	/**
	 * Returns a promise that resolves when the connection is closed.
	 * @returns A promise that resolves when closed
	 */
	async closed(): Promise<void> {
		await this.#quic.closed;
	}
}
