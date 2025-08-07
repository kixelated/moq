import type { AnnouncedConsumer } from "../announced";
import type { BroadcastConsumer } from "../broadcast";
import type { Connection as ConnectionInterface } from "../connection";
import * as Path from "../path";
import { type Reader, Readers, type Stream } from "../stream";
import { unreachable } from "../util";
import { Announce, AnnounceCancel, AnnounceError, AnnounceOk, Unannounce } from "./announce";
import * as Control from "./control";
import { Fetch, FetchError, FetchOk } from "./fetch";
import { GoAway } from "./goaway";
import { Group, readStreamType } from "./object";
import { Publisher } from "./publisher";
import * as Setup from "./setup";
import { Subscribe, SubscribeDone, SubscribeError, SubscribeOk, Unsubscribe } from "./subscribe";
import {
	SubscribeAnnounces,
	SubscribeAnnouncesError,
	SubscribeAnnouncesOk,
	UnsubscribeAnnounces,
} from "./subscribe_announces";
import { Subscriber } from "./subscriber";
import { TrackStatus, TrackStatusRequest } from "./track";

/**
 * Represents a connection to a MoQ server using moq-transport protocol.
 *
 * @public
 */
export class Connection implements ConnectionInterface {
	// The URL of the connection.
	readonly url: URL;

	// The established WebTransport session.
	#quic: WebTransport;

	// The single bidirectional control stream for control messages
	#controlStream: Stream;

	// Module for contributing tracks.
	#publisher: Publisher;

	// Module for distributing tracks.
	#subscriber: Subscriber;

	/**
	 * Creates a new Connection instance.
	 * @param url - The URL of the connection
	 * @param quic - The WebTransport session
	 * @param controlStream - The control stream
	 *
	 * @internal
	 */
	constructor(url: URL, quic: WebTransport, controlStream: Stream) {
		this.url = url;
		this.#quic = quic;
		this.#controlStream = controlStream;

		// The root path of the connection, to emulate moq-lite.
		const root = Path.from(url.pathname);

		this.#publisher = new Publisher(this.#quic, this.#controlStream.writer, root);
		this.#subscriber = new Subscriber(this.#controlStream.writer, root);

		this.#run();
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
		const controlMessages = this.#runControlStream();
		const objectStreams = this.#runObjectStreams();

		try {
			await Promise.all([controlMessages, objectStreams]);
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

	/**
	 * Handles control messages on the single bidirectional control stream.
	 */
	async #runControlStream() {
		for (;;) {
			try {
				const msg = await Control.read(this.#controlStream.reader);

				// Route control messages to appropriate handlers based on type
				// Messages sent by Subscriber, received by Publisher:
				if (msg instanceof Subscribe) {
					await this.#publisher.handleSubscribe(msg);
				} else if (msg instanceof Unsubscribe) {
					await this.#publisher.handleUnsubscribe(msg);
				} else if (msg instanceof TrackStatusRequest) {
					await this.#publisher.handleTrackStatusRequest(msg);
				} else if (msg instanceof AnnounceOk) {
					await this.#publisher.handleAnnounceOk(msg);
				} else if (msg instanceof AnnounceError) {
					await this.#publisher.handleAnnounceError(msg);
				} else if (msg instanceof AnnounceCancel) {
					await this.#publisher.handleAnnounceCancel(msg);
					// Messages sent by Publisher, received by Subscriber:
				} else if (msg instanceof Announce) {
					await this.#subscriber.handleAnnounce(msg);
				} else if (msg instanceof Unannounce) {
					await this.#subscriber.handleUnannounce(msg);
				} else if (msg instanceof SubscribeOk) {
					await this.#subscriber.handleSubscribeOk(msg);
				} else if (msg instanceof SubscribeError) {
					await this.#subscriber.handleSubscribeError(msg);
				} else if (msg instanceof SubscribeDone) {
					await this.#subscriber.handleSubscribeDone(msg);
				} else if (msg instanceof TrackStatus) {
					await this.#subscriber.handleTrackStatus(msg);
					// Other messages:
				} else if (msg instanceof GoAway) {
					await this.#handleGoAway(msg);
				} else if (msg instanceof Setup.Client) {
					await this.#handleClientSetup(msg);
				} else if (msg instanceof Setup.Server) {
					await this.#handleServerSetup(msg);
				} else if (msg instanceof SubscribeAnnounces) {
					await this.#publisher.handleSubscribeAnnounces(msg);
				} else if (msg instanceof SubscribeAnnouncesOk) {
					await this.#subscriber.handleSubscribeAnnouncesOk(msg);
				} else if (msg instanceof SubscribeAnnouncesError) {
					await this.#subscriber.handleSubscribeAnnouncesError(msg);
				} else if (msg instanceof UnsubscribeAnnounces) {
					await this.#publisher.handleUnsubscribeAnnounces(msg);
				} else if (msg instanceof Fetch) {
					// no
				} else if (msg instanceof FetchOk) {
					// no
				} else if (msg instanceof FetchError) {
					// no
					// } else if (msg instanceof FetchCancel) {
					// For some reason Typescript doesn't like FetchCancel?
				} else {
					unreachable(msg);
				}
			} catch (err) {
				console.error("error processing control message", err);
				break;
			}
		}

		console.warn("control stream closed");
	}

	/**
	 * Handles a GoAway control message.
	 * @param msg - The GoAway message
	 */
	async #handleGoAway(msg: GoAway) {
		console.warn(`MOQLITE_INCOMPATIBLE: Received GOAWAY with redirect URI: ${msg.newSessionUri}`);
		// In moq-lite compatibility mode, we don't support session redirection
		// Just close the connection
		this.close();
	}

	/**
	 * Handles an unexpected CLIENT_SETUP control message.
	 * @param msg - The CLIENT_SETUP message
	 */
	async #handleClientSetup(_msg: Setup.Client) {
		console.error("Unexpected CLIENT_SETUP message received after connection established");
		this.close();
	}

	/**
	 * Handles an unexpected SERVER_SETUP control message.
	 * @param msg - The SERVER_SETUP message
	 */
	async #handleServerSetup(_msg: Setup.Server) {
		console.error("Unexpected SERVER_SETUP message received after connection established");
		this.close();
	}

	/**
	 * Handles object streams (unidirectional streams for media delivery).
	 */
	async #runObjectStreams() {
		const readers = new Readers(this.#quic);

		for (;;) {
			const stream = await readers.next();
			if (!stream) {
				break;
			}

			this.#runObjectStream(stream)
				.then(() => {
					stream.stop(new Error("cancel"));
				})
				.catch((err: unknown) => {
					stream.stop(err);
				});
		}
	}

	/**
	 * Handles a single object stream.
	 */
	async #runObjectStream(stream: Reader) {
		try {
			await readStreamType(stream);

			const header = await Group.decode(stream);
			await this.#subscriber.handleGroup(header, stream);
		} catch (err) {
			console.error("error processing object stream", err);
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
