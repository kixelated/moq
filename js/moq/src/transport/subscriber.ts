import { type AnnouncedConsumer, AnnouncedProducer } from "../announced";
import { type BroadcastConsumer, BroadcastProducer } from "../broadcast";
import { GroupProducer } from "../group";
import * as Path from "../path";
import type { Reader, Writer } from "../stream";
import type { TrackProducer } from "../track";
import { error } from "../util/error";
import { type Announce, type AnnounceCancel, AnnounceError, type AnnounceOk, type Unannounce } from "./announce";
import * as Control from "./control";
import { ObjectStatus, ObjectStream, type StreamHeaderSubgroup } from "./object";
import { Subscribe, type SubscribeDone, SubscribeError, type SubscribeOk, type Unsubscribe } from "./subscribe";
import { TrackStatus } from "./track";

/**
 * Handles subscribing to broadcasts using moq-transport protocol with lite-compatibility restrictions.
 *
 * @internal
 */
export class Subscriber {
	#controlWriter: Writer;

	// Our subscribed tracks - keyed by subscription ID
	#subscribes = new Map<bigint, TrackProducer>();
	#subscribeNext = 0n;

	// Track subscription responses - keyed by subscription ID
	#subscribeCallbacks = new Map<
		bigint,
		{
			resolve: (msg: SubscribeOk) => void;
			reject: (msg: SubscribeError) => void;
		}
	>();

	/**
	 * Creates a new Subscriber instance.
	 * @param quic - The WebTransport session to use
	 * @param controlWriter - The control stream writer for sending control messages
	 *
	 * @internal
	 */
	constructor(controlWriter: Writer) {
		this.#controlWriter = controlWriter;
	}

	/**
	 * Gets an announced reader for the specified prefix.
	 * @param prefix - The prefix for announcements
	 * @returns An AnnounceConsumer instance
	 */
	announced(prefix: Path.Valid = Path.empty()): AnnouncedConsumer {
		console.debug(`announce please: prefix=${prefix}`);

		const producer = new AnnouncedProducer();
		const consumer = producer.consume(prefix);

		// In moq-transport, announcements are typically handled differently
		// For lite compatibility, we simulate the announce/unannounce pattern
		// by creating a mock announced stream that immediately provides available broadcasts

		// Since moq-transport doesn't have explicit announce streams like moq-lite,
		// we provide a compatibility layer that simulates announcements
		(async () => {
			try {
				// For moq-transport compatibility, we would typically discover tracks
				// through other means (catalog, out-of-band, etc.)
				// For now, we provide an empty announcement stream
				console.warn(
					"MOQLITE_COMPATIBILITY: Announcements in moq-transport require external catalog/discovery",
				);
				producer.close();
			} catch (err: unknown) {
				producer.abort(error(err));
			}
		})();

		return consumer;
	}

	/**
	 * Consumes a broadcast from the connection.
	 *
	 * NOTE: This is not automatically deduplicated.
	 * If to consume the same broadcast twice, and subscribe to the same tracks twice, then network usage is doubled.
	 * However, you can call `clone()` on the consumer to deduplicate and share the same handle.
	 *
	 * @param name - The name of the broadcast to consume
	 * @returns A BroadcastConsumer instance
	 */
	consume(broadcast: Path.Valid): BroadcastConsumer {
		const producer = new BroadcastProducer();
		const consumer = producer.consume();

		producer.unknownTrack((track) => {
			// Save the track in the cache to deduplicate.
			// NOTE: We don't clone it (yet) so it doesn't count as an active consumer.
			// When we do clone it, we'll only get the most recent (consumed) group.
			producer.insertTrack(track.consume());

			// Perform the subscription in the background.
			this.#runSubscribe(broadcast, track).finally(() => {
				try {
					producer.removeTrack(track.name);
				} catch {
					// Already closed.
					console.warn("track already removed");
				}
			});
		});

		// Close when the producer has no more consumers.
		producer.unused().finally(() => {
			producer.close();
		});

		return consumer;
	}

	async #runSubscribe(broadcast: Path.Valid, track: TrackProducer) {
		const subscribeId = this.#subscribeNext++;

		// Save the writer so we can append groups to it.
		this.#subscribes.set(subscribeId, track);

		const msg = new Subscribe(
			subscribeId,
			subscribeId,
			broadcast,
			track.name,
			track.priority,
			0, // groupOrder (default)
			0, // filterType (no filter for lite compatibility)
		);

		// Send SUBSCRIBE message on control stream and wait for response
		const responsePromise = new Promise<SubscribeOk>((resolve, reject) => {
			this.#subscribeCallbacks.set(subscribeId, { resolve, reject });
		});

		await Control.write(this.#controlWriter, msg);

		try {
			const okMsg = await responsePromise;
			this.#validateSubscribeOk(okMsg);
			console.debug(`subscribe ok: id=${subscribeId} broadcast=${broadcast} track=${track.name}`);

			await Promise.race([track.unused()]);

			track.close();
			console.debug(`subscribe close: id=${subscribeId} broadcast=${broadcast} track=${track.name}`);
		} catch (err) {
			track.abort(error(err));
			console.warn(
				`subscribe error: id=${subscribeId} broadcast=${broadcast} track=${track.name} error=${error(err)}`,
			);
		} finally {
			this.#subscribes.delete(subscribeId);
			this.#subscribeCallbacks.delete(subscribeId);
		}
	}

	/**
	 * Handles a SUBSCRIBE_OK control message received on the control stream.
	 * @param msg - The SUBSCRIBE_OK message
	 *
	 * @internal
	 */
	async handleSubscribeOk(msg: SubscribeOk) {
		const callback = this.#subscribeCallbacks.get(msg.subscribeId);
		if (callback) {
			callback.resolve(msg);
		} else {
			console.warn(`received SUBSCRIBE_OK for unknown subscription: ${msg.subscribeId}`);
		}
	}

	/**
	 * Handles a SUBSCRIBE_ERROR control message received on the control stream.
	 * @param msg - The SUBSCRIBE_ERROR message
	 *
	 * @internal
	 */
	async handleSubscribeError(msg: SubscribeError) {
		const callback = this.#subscribeCallbacks.get(msg.subscribeId);
		if (callback) {
			callback.reject(msg);
		} else {
			console.warn(`received SUBSCRIBE_ERROR for unknown subscription: ${msg.subscribeId}`);
		}
	}

	/**
	 * Validates that a SUBSCRIBE_OK response uses only lite-compatible features.
	 * @param msg - The SUBSCRIBE_OK message to validate
	 * @throws Error if unsupported features are detected
	 */
	#validateSubscribeOk(msg: SubscribeOk): void {
		// Check group order - we only support the default
		if (msg.groupOrder !== 0) {
			throw new Error(`MOQLITE_INCOMPATIBLE: Non-default group order not supported: ${msg.groupOrder}`);
		}

		// Expires field is informational only for lite compatibility
		if (msg.expires > 0) {
			console.debug(`MOQLITE_COMPATIBILITY: Subscription expires in ${msg.expires}ms (informational only)`);
		}
	}

	/**
	 * Handles an ObjectStream message (moq-transport equivalent of moq-lite Group).
	 * @param msg - The ObjectStream message
	 * @param stream - The stream to read object data from
	 *
	 * @internal
	 */
	async runObjectStream(header: StreamHeaderSubgroup, stream: Reader) {
		const subscribe = this.#subscribes.get(header.subscribeId);
		if (!subscribe) {
			console.warn(`unknown subscription: id=${header.subscribeId}`);
			return;
		}

		// Convert to Group (moq-lite equivalent)
		const groupId = Number(header.groupId);
		const producer = new GroupProducer(groupId);
		subscribe.insertGroup(producer.consume());

		try {
			// Read objects from the stream until end of group
			for (;;) {
				const done = await Promise.race([stream.done(), subscribe.unused(), producer.unused()]);
				if (done !== false) break;

				const obj = await ObjectStream.decode(stream);

				// Handle object status
				if (obj.objectStatus === ObjectStatus.EndOfGroup) {
					break;
				}
				if (obj.objectStatus === ObjectStatus.EndOfTrack) {
					break;
				}
				if (obj.objectStatus !== ObjectStatus.Normal) {
					console.warn(`Unsupported object status: ${obj.objectStatus}`);
					continue;
				}

				// Treat each object payload as a frame
				producer.writeFrame(obj.objectPayload);
			}

			producer.close();
		} catch (err: unknown) {
			producer.abort(error(err));
		}
	}

	/**
	 * Handles a TrackStatus message.
	 * @param msg - The TrackStatus message
	 *
	 * @internal
	 */
	async runTrackStatus(msg: TrackStatus) {
		// TrackStatus messages are informational in moq-transport
		// For lite compatibility, we log them but don't take action
		console.debug(
			`track status: ${msg.trackNamespace}/${msg.trackName} status=${msg.statusCode} lastGroup=${msg.lastGroupId} lastObject=${msg.lastObjectId}`,
		);

		// Validate status codes
		if (
			msg.statusCode !== TrackStatus.STATUS_IN_PROGRESS &&
			msg.statusCode !== TrackStatus.STATUS_NOT_FOUND &&
			msg.statusCode !== TrackStatus.STATUS_NOT_AUTHORIZED &&
			msg.statusCode !== TrackStatus.STATUS_ENDED
		) {
			console.warn(`MOQLITE_COMPATIBILITY: Unknown track status code: ${msg.statusCode}`);
		}
	}

	/**
	 * Handles an ANNOUNCE_OK control message received on the control stream.
	 * @param msg - The ANNOUNCE_OK message
	 */
	async handleAnnounceOk(msg: AnnounceOk) {
		console.warn(`MOQLITE_INCOMPATIBLE: Received ANNOUNCE_OK for namespace: ${msg.trackNamespace}`);
		// moq-lite doesn't support track namespace announcements
	}

	/**
	 * Handles an ANNOUNCE_ERROR control message received on the control stream.
	 * @param msg - The ANNOUNCE_ERROR message
	 */
	async handleAnnounceError(msg: AnnounceError) {
		console.warn(
			`MOQLITE_INCOMPATIBLE: Received ANNOUNCE_ERROR for namespace: ${msg.trackNamespace}, error: ${msg.errorCode} - ${msg.reasonPhrase}`,
		);
		// moq-lite doesn't support track namespace announcements
	}

	/**
	 * Handles an ANNOUNCE_CANCEL control message received on the control stream.
	 * @param msg - The ANNOUNCE_CANCEL message
	 */
	async handleAnnounceCancel(msg: AnnounceCancel) {
		console.warn(`MOQLITE_INCOMPATIBLE: Received ANNOUNCE_CANCEL for namespace: ${msg.trackNamespace}`);
		// moq-lite doesn't support track namespace announcements
	}

	/**
	 * Handles an UNSUBSCRIBE control message received on the control stream.
	 * @param msg - The UNSUBSCRIBE message
	 */
	async handleUnsubscribe(msg: Unsubscribe) {
		console.warn(`MOQLITE_INCOMPATIBLE: Received UNSUBSCRIBE for subscription: ${msg.subscribeId}`);
		// In moq-lite, subscriptions are tied to stream lifecycle, not explicit unsubscribe messages
		// We could potentially close the corresponding subscription here, but for now we log it
	}

	/**
	 * Handles a SUBSCRIBE_DONE control message received on the control stream.
	 * @param msg - The SUBSCRIBE_DONE message
	 */
	async handleSubscribeDone(msg: SubscribeDone) {
		console.debug(`subscribe done: id=${msg.subscribeId} status=${msg.statusCode} reason=${msg.reasonPhrase}`);

		// For lite compatibility, we treat this as subscription completion
		const callback = this.#subscribeCallbacks.get(msg.subscribeId);
		if (callback) {
			// Treat SUBSCRIBE_DONE as an error since the subscription ended
			const error = new SubscribeError(
				msg.subscribeId,
				msg.statusCode,
				msg.reasonPhrase,
				0n, // No track alias in SUBSCRIBE_DONE
			);
			callback.reject(error);
		} else {
			console.warn(`received SUBSCRIBE_DONE for unknown subscription: ${msg.subscribeId}`);
		}
	}

	/**
	 * Handles an ANNOUNCE control message received on the control stream.
	 * @param msg - The ANNOUNCE message
	 */
	async handleAnnounce(msg: Announce) {
		console.warn(`MOQLITE_INCOMPATIBLE: Received ANNOUNCE for namespace: ${msg.trackNamespace}`);
		// In moq-transport, ANNOUNCE is sent by publishers to advertise track namespaces
		// moq-lite doesn't support track namespace announcements
		// Send ANNOUNCE_ERROR response
		const errorMsg = new AnnounceError(
			msg.trackNamespace,
			501, // Not implemented
			"ANNOUNCE not supported in moq-lite compatibility mode",
		);
		await Control.write(this.#controlWriter, errorMsg);
	}

	/**
	 * Handles an UNANNOUNCE control message received on the control stream.
	 * @param msg - The UNANNOUNCE message
	 */
	async handleUnannounce(msg: Unannounce) {
		console.warn(`MOQLITE_INCOMPATIBLE: Received UNANNOUNCE for namespace: ${msg.trackNamespace}`);
		// In moq-transport, UNANNOUNCE is sent by publishers to stop serving track namespaces
		// moq-lite doesn't support track namespace announcements, so nothing to unannounce
	}

	/**
	 * Handles a TRACK_STATUS control message received on the control stream.
	 * @param msg - The TRACK_STATUS message
	 */
	async handleTrackStatus(msg: TrackStatus) {
		// TrackStatus messages are informational in moq-transport
		// For lite compatibility, we log them but don't take action
		console.debug(
			`track status: ${msg.trackNamespace}/${msg.trackName} status=${msg.statusCode} lastGroup=${msg.lastGroupId} lastObject=${msg.lastObjectId}`,
		);

		// Validate status codes
		if (
			msg.statusCode !== TrackStatus.STATUS_IN_PROGRESS &&
			msg.statusCode !== TrackStatus.STATUS_NOT_FOUND &&
			msg.statusCode !== TrackStatus.STATUS_NOT_AUTHORIZED &&
			msg.statusCode !== TrackStatus.STATUS_ENDED
		) {
			console.warn(`MOQLITE_COMPATIBILITY: Unknown track status code: ${msg.statusCode}`);
		}
	}
}
