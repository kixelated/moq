import type { Announced } from "../announced.ts";
import type { Broadcast } from "../broadcast.ts";
import type { Established } from "../connection/established.ts";
import * as Path from "../path.js";
import { type Reader, Readers, type Stream } from "../stream.ts";
import { unreachable } from "../util/index.ts";
import {
	PublishNamespace,
	PublishNamespaceCancel,
	PublishNamespaceDone,
	PublishNamespaceError,
	PublishNamespaceOk,
} from "./announce.ts";
import * as Control from "./control.ts";
import { Fetch, FetchCancel, FetchError, FetchOk } from "./fetch.ts";
import { GoAway } from "./goaway.ts";
import { Group as GroupMessage, readStreamType } from "./object.ts";
import { Publish, PublishError, PublishOk } from "./publish.ts";
import { Publisher } from "./publisher.ts";
import * as Setup from "./setup.ts";
import { PublishDone, Subscribe, SubscribeError, SubscribeOk, Unsubscribe } from "./subscribe.ts";
import {
	SubscribeNamespace,
	SubscribeNamespaceError,
	SubscribeNamespaceOk,
	UnsubscribeNamespace,
} from "./subscribe_announces.ts";
import { Subscriber } from "./subscriber.ts";
import { TrackStatus, TrackStatusRequest } from "./track.ts";

/**
 * Represents a connection to a MoQ server using moq-transport protocol.
 *
 * @public
 */
export class Connection implements Established {
	// The URL of the connection.
	readonly url: URL;

	// The established WebTransport session.
	#quic: WebTransport;

	// The single bidirectional control stream for control messages
	#control: Control.Stream;

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
	constructor(url: URL, quic: WebTransport, control: Stream) {
		this.url = url;
		this.#quic = quic;
		this.#control = new Control.Stream(control);
		this.#publisher = new Publisher(this.#quic, this.#control);
		this.#subscriber = new Subscriber(this.#control);

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
	publish(path: Path.Valid, broadcast: Broadcast) {
		this.#publisher.publish(path, broadcast);
	}

	/**
	 * Gets an announced reader for the specified prefix.
	 * @param prefix - The prefix for announcements
	 * @returns An AnnounceConsumer instance
	 */
	announced(prefix = Path.empty()): Announced {
		return this.#subscriber.announced(prefix);
	}

	/**
	 * Consumes a broadcast from the connection.
	 *
	 * @remarks
	 * If the broadcast is not found, a "not found" error will be thrown when requesting any tracks.
	 *
	 * @param broadcast - The path of the broadcast to consume
	 * @returns A Broadcast instance
	 */
	consume(broadcast: Path.Valid): Broadcast {
		return this.#subscriber.consume(broadcast);
	}

	/**
	 * Handles control messages on the single bidirectional control stream.
	 */
	async #runControlStream() {
		for (;;) {
			try {
				const msg = await this.#control.read();

				// Route control messages to appropriate handlers based on type
				// Messages sent by Subscriber, received by Publisher:
				if (msg instanceof Subscribe) {
					await this.#publisher.handleSubscribe(msg);
				} else if (msg instanceof Unsubscribe) {
					await this.#publisher.handleUnsubscribe(msg);
				} else if (msg instanceof TrackStatusRequest) {
					await this.#publisher.handleTrackStatusRequest(msg);
				} else if (msg instanceof PublishNamespaceOk) {
					await this.#publisher.handlePublishNamespaceOk(msg);
				} else if (msg instanceof PublishNamespaceError) {
					await this.#publisher.handlePublishNamespaceError(msg);
				} else if (msg instanceof PublishNamespaceCancel) {
					await this.#publisher.handlePublishNamespaceCancel(msg);
					// Messages sent by Publisher, received by Subscriber:
				} else if (msg instanceof PublishNamespace) {
					await this.#subscriber.handlePublishNamespace(msg);
				} else if (msg instanceof PublishNamespaceDone) {
					await this.#subscriber.handlePublishNamespaceDone(msg);
				} else if (msg instanceof SubscribeOk) {
					await this.#subscriber.handleSubscribeOk(msg);
				} else if (msg instanceof SubscribeError) {
					await this.#subscriber.handleSubscribeError(msg);
				} else if (msg instanceof PublishDone) {
					await this.#subscriber.handlePublishDone(msg);
				} else if (msg instanceof TrackStatus) {
					await this.#subscriber.handleTrackStatus(msg);
					// Other messages:
				} else if (msg instanceof GoAway) {
					await this.#handleGoAway(msg);
				} else if (msg instanceof Setup.ClientSetup) {
					await this.#handleClientSetup(msg);
				} else if (msg instanceof Setup.ServerSetup) {
					await this.#handleServerSetup(msg);
				} else if (msg instanceof SubscribeNamespace) {
					await this.#publisher.handleSubscribeNamespace(msg);
				} else if (msg instanceof SubscribeNamespaceOk) {
					await this.#subscriber.handleSubscribeNamespaceOk(msg);
				} else if (msg instanceof SubscribeNamespaceError) {
					await this.#subscriber.handleSubscribeNamespaceError(msg);
				} else if (msg instanceof UnsubscribeNamespace) {
					await this.#publisher.handleUnsubscribeNamespace(msg);
				} else if (msg instanceof Publish) {
					// Publish messages are not yet supported
				} else if (msg instanceof PublishOk) {
					// Publish messages are not yet supported
				} else if (msg instanceof PublishError) {
					// Publish messages are not yet supported
				} else if (msg instanceof Fetch) {
					// Fetch messages are not supported
				} else if (msg instanceof FetchOk) {
					// Fetch messages are not supported
				} else if (msg instanceof FetchError) {
					// Fetch messages are not supported
				} else if (msg instanceof FetchCancel) {
					// Fetch messages are not supported
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
	async #handleClientSetup(_msg: Setup.ClientSetup) {
		console.error("Unexpected CLIENT_SETUP message received after connection established");
		this.close();
	}

	/**
	 * Handles an unexpected SERVER_SETUP control message.
	 * @param msg - The SERVER_SETUP message
	 */
	async #handleServerSetup(_msg: Setup.ServerSetup) {
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

			const header = await GroupMessage.decode(stream);
			await this.#subscriber.handleGroup(header, stream);
		} catch (err) {
			console.error("error processing object stream", err);
		}
	}

	/**
	 * Returns a promise that resolves when the connection is closed.
	 * @returns A promise that resolves when closed
	 */
	get closed(): Promise<void> {
		return this.#quic.closed.then(() => undefined);
	}
}
