import type { AnnouncedConsumer } from "../announced";
import type { BroadcastConsumer } from "../broadcast";
import type { Connection as ConnectionInterface } from "../connection";
import * as Path from "../path";
import { type Reader, Readers, Stream } from "../stream";
import { AnnounceInterest } from "./announce";
import { Group } from "./group";
import { Publisher } from "./publisher";
import { SessionInfo } from "./session";
import { StreamId } from "./stream";
import { Subscribe } from "./subscribe";
import { Subscriber } from "./subscriber";

/**
 * Represents a connection to a MoQ server.
 *
 * @public
 */
export class Connection implements ConnectionInterface {
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

	// Just to avoid logging when `close()` is called.
	#closed = false;

	/**
	 * Creates a new Connection instance.
	 * @param url - The URL of the connection
	 * @param quic - The WebTransport session
	 * @param session - The session stream
	 *
	 * @internal
	 */
	constructor(url: URL, quic: WebTransport, session: Stream) {
		this.url = url;
		this.#quic = quic;
		this.#session = session;

		this.#publisher = new Publisher(this.#quic);
		this.#subscriber = new Subscriber(this.#quic);

		this.#run();
	}

	/**
	 * Closes the connection.
	 */
	close() {
		this.#closed = true;
		this.#publisher.close();
		this.#subscriber.close();
		this.#quic.close();
	}

	async #run(): Promise<void> {
		const session = this.#runSession();
		const bidis = this.#runBidis();
		const unis = this.#runUnis();

		try {
			await Promise.all([session, bidis, unis]);
		} catch (err) {
			if (!this.#closed) {
				console.error("fatal error running connection", err);
			}
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
			const msg = await SessionInfo.decodeMaybe(this.#session.reader);
			if (!msg) break;
			// TODO use the session info
		}

		console.warn("session stream closed");
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

		if (typ === StreamId.Session) {
			throw new Error("duplicate session stream");
		} else if (typ === StreamId.Announce) {
			const msg = await AnnounceInterest.decode(stream.reader);
			await this.#publisher.runAnnounce(msg, stream);
			return;
		} else if (typ === StreamId.Subscribe) {
			const msg = await Subscribe.decode(stream.reader);
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
		if (typ === 0) {
			const msg = await Group.decode(stream);
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
