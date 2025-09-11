import { type AnnouncedConsumer, AnnouncedProducer } from "../announced.ts";
import { type BroadcastConsumer, BroadcastProducer } from "../broadcast.ts";
import { GroupProducer } from "../group.ts";
import * as Path from "../path.ts";
import type { Reader } from "../stream.ts";
import type { TrackProducer } from "../track.ts";
import { error } from "../util/error.ts";
import type { Announce, Unannounce } from "./announce.ts";
import type * as Control from "./control.ts";
import { Frame, type Group } from "./object.ts";
import { Subscribe, type SubscribeDone, type SubscribeError, type SubscribeOk, Unsubscribe } from "./subscribe.ts";
import type { SubscribeAnnouncesError, SubscribeAnnouncesOk } from "./subscribe_announces.ts";
import type { TrackStatus } from "./track.ts";

/**
 * Handles subscribing to broadcasts using moq-transport protocol with lite-compatibility restrictions.
 *
 * @internal
 */
export class Subscriber {
	#control: Control.Stream;
	#root: Path.Valid;

	// Our subscribed tracks - keyed by subscription ID
	#subscribes = new Map<bigint, TrackProducer>();
	#subscribeNext = 0n;

	// Track subscription responses - keyed by subscription ID
	#subscribeCallbacks = new Map<
		bigint,
		{
			resolve: (msg: SubscribeOk) => void;
			reject: (msg: Error) => void;
		}
	>();

	#announced: AnnouncedProducer;

	/**
	 * Creates a new Subscriber instance.
	 * @param quic - The WebTransport session to use
	 * @param control - The control stream writer for sending control messages
	 *
	 * @internal
	 */
	constructor(control: Control.Stream, root: Path.Valid) {
		this.#control = control;
		this.#root = root;
		this.#announced = new AnnouncedProducer();
		//void this.#runAnnounced();
	}

	/* TODO once the remote server actually supports it
	async #runAnnounced() {
		// Send me everything at the root.
		const msg = new SubscribeAnnounces(this.#root);
		await Control.write(this.#control, msg);
	}
	*/

	/**
	 * Gets an announced reader for the specified prefix.
	 * @param prefix - The prefix for announcements
	 * @returns An AnnounceConsumer instance
	 */
	announced(prefix: Path.Valid = Path.empty()): AnnouncedConsumer {
		const full = Path.join(this.#root, prefix);
		return this.#announced.consume(full);
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

		const msg = new Subscribe(subscribeId, subscribeId, broadcast, track.name, track.priority);

		// Send SUBSCRIBE message on control stream and wait for response
		const responsePromise = new Promise<SubscribeOk>((resolve, reject) => {
			this.#subscribeCallbacks.set(subscribeId, { resolve, reject });
		});

		await this.#control.write(msg);

		try {
			await responsePromise;
			await track.unused();

			track.close();

			const msg = new Unsubscribe(subscribeId);
			await this.#control.write(msg);
		} catch (err) {
			const e = error(err);
			track.abort(e);
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
			callback.reject(new Error(`SUBSCRIBE_ERROR: code=${msg.errorCode} reason=${msg.reasonPhrase}`));
		}
	}

	/**
	 * Handles an ObjectStream message (moq-transport equivalent of moq-lite Group).
	 * @param msg - The ObjectStream message
	 * @param stream - The stream to read object data from
	 *
	 * @internal
	 */
	async handleGroup(group: Group, stream: Reader) {
		const producer = new GroupProducer(group.groupId);

		try {
			const track = this.#subscribes.get(group.trackAlias);
			if (!track) {
				throw new Error(`unknown track: alias=${group.trackAlias}`);
			}

			// Convert to Group (moq-lite equivalent)
			track.insertGroup(producer.consume());

			// Read objects from the stream until end of group
			for (;;) {
				const done = await Promise.race([stream.done(), track.unused(), producer.unused()]);
				if (done !== false) break;

				const frame = await Frame.decode(stream);
				if (frame.payload === undefined) break;

				// Treat each object payload as a frame
				producer.writeFrame(frame.payload);
			}

			producer.close();
		} catch (err: unknown) {
			const e = error(err);
			producer.abort(e);
			stream.stop(e);
		}
	}

	/**
	 * Handles a SUBSCRIBE_DONE control message received on the control stream.
	 * @param msg - The SUBSCRIBE_DONE message
	 */
	async handleSubscribeDone(msg: SubscribeDone) {
		// For lite compatibility, we treat this as subscription completion
		const callback = this.#subscribeCallbacks.get(msg.subscribeId);
		if (callback) {
			callback.reject(new Error(`SUBSCRIBE_DONE: code=${msg.statusCode} reason=${msg.reasonPhrase}`));
		}
	}

	/**
	 * Handles an ANNOUNCE control message received on the control stream.
	 * @param msg - The ANNOUNCE message
	 */
	async handleAnnounce(msg: Announce) {
		this.#announced.write({
			name: msg.trackNamespace,
			active: true,
		});
	}

	/**
	 * Handles an UNANNOUNCE control message received on the control stream.
	 * @param msg - The UNANNOUNCE message
	 */
	async handleUnannounce(msg: Unannounce) {
		this.#announced.write({
			name: msg.trackNamespace,
			active: false,
		});
	}

	async handleSubscribeAnnouncesOk(_msg: SubscribeAnnouncesOk) {
		// TODO
	}

	async handleSubscribeAnnouncesError(_msg: SubscribeAnnouncesError) {
		// TODO
	}

	/**
	 * Handles a TRACK_STATUS control message received on the control stream.
	 * @param msg - The TRACK_STATUS message
	 */
	async handleTrackStatus(_msg: TrackStatus) {
		// TODO
	}
}
