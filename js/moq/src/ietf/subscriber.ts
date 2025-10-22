import { Announced } from "../announced.ts";
import { Broadcast, type TrackRequest } from "../broadcast.ts";
import { Group } from "../group.ts";
import * as Path from "../path.js";
import type { Reader } from "../stream.ts";
import type { Track } from "../track.ts";
import { error } from "../util/error.ts";
import type { PublishNamespace, PublishNamespaceDone } from "./announce.ts";
import type * as Control from "./control.ts";
import { Frame, type Group as GroupMessage } from "./object.ts";
import { type PublishDone, Subscribe, type SubscribeError, type SubscribeOk, Unsubscribe } from "./subscribe.ts";
import type { SubscribeNamespaceError, SubscribeNamespaceOk } from "./subscribe_announces.ts";
import type { TrackStatus } from "./track.ts";

/**
 * Handles subscribing to broadcasts using moq-transport protocol with lite-compatibility restrictions.
 *
 * @internal
 */
export class Subscriber {
	#control: Control.Stream;

	// Our subscribed tracks - keyed by subscription ID
	#subscribes = new Map<bigint, Track>();
	#subscribeNext = 0n;

	// Track subscription responses - keyed by subscription ID
	#subscribeCallbacks = new Map<
		bigint,
		{
			resolve: (msg: SubscribeOk) => void;
			reject: (msg: Error) => void;
		}
	>();

	/**
	 * Creates a new Subscriber instance.
	 * @param quic - The WebTransport session to use
	 * @param control - The control stream writer for sending control messages
	 *
	 * @internal
	 */
	constructor(control: Control.Stream) {
		this.#control = control;
		//void this.#runAnnounced();
	}

	/**
	 * Gets an announced reader for the specified prefix.
	 * @param prefix - The prefix for announcements
	 * @returns An AnnounceConsumer instance
	 */
	announced(_prefix = Path.empty()): Announced {
		const announced = new Announced();
		return announced;

		/* TODO once the remote server actually supports it
		async #runAnnounced() {
			// Send me everything at the root.
			const msg = new SubscribeAnnounces(this.#root);
			await Control.write(this.#control, msg);
		}
		*/
	}

	/**
	 * Consumes a broadcast from the connection.
	 *
	 * @param name - The name of the broadcast to consume
	 * @returns A Broadcast instance
	 */
	consume(path: Path.Valid): Broadcast {
		const broadcast = new Broadcast();

		(async () => {
			for (;;) {
				const request = await broadcast.requested();
				if (!request) break;
				this.#runSubscribe(path, request);
			}
		})();

		return broadcast;
	}

	async #runSubscribe(broadcast: Path.Valid, request: TrackRequest) {
		const requestId = this.#subscribeNext++;

		// Save the writer so we can append groups to it.
		this.#subscribes.set(requestId, request.track);

		const msg = new Subscribe(requestId, broadcast, request.track.name, request.priority);

		// Send SUBSCRIBE message on control stream and wait for response
		const responsePromise = new Promise<SubscribeOk>((resolve, reject) => {
			this.#subscribeCallbacks.set(requestId, { resolve, reject });
		});

		await this.#control.write(msg);

		try {
			await responsePromise;
			await request.track.closed;

			const msg = new Unsubscribe(requestId);
			await this.#control.write(msg);
		} catch (err) {
			const e = error(err);
			request.track.close(e);
		} finally {
			this.#subscribes.delete(requestId);
			this.#subscribeCallbacks.delete(requestId);
		}
	}

	/**
	 * Handles a SUBSCRIBE_OK control message received on the control stream.
	 * @param msg - The SUBSCRIBE_OK message
	 *
	 * @internal
	 */
	async handleSubscribeOk(msg: SubscribeOk) {
		const callback = this.#subscribeCallbacks.get(msg.requestId);
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
		const callback = this.#subscribeCallbacks.get(msg.requestId);
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
	async handleGroup(group: GroupMessage, stream: Reader) {
		const producer = new Group(group.groupId);

		try {
			const track = this.#subscribes.get(group.trackAlias);
			if (!track) {
				throw new Error(`unknown track: alias=${group.trackAlias}`);
			}

			// Convert to Group (moq-lite equivalent)
			track.writeGroup(producer);

			// Read objects from the stream until end of group
			for (;;) {
				const done = await Promise.race([stream.done(), producer.closed, track.closed]);
				if (done !== false) break;

				const frame = await Frame.decode(stream);
				if (frame.payload === undefined) break;

				// Treat each object payload as a frame
				producer.writeFrame(frame.payload);
			}

			producer.close();
		} catch (err: unknown) {
			const e = error(err);
			producer.close(e);
			stream.stop(e);
		}
	}

	/**
	 * Handles a PUBLISH_DONE control message received on the control stream.
	 * @param msg - The PUBLISH_DONE message
	 */
	async handlePublishDone(msg: PublishDone) {
		// For lite compatibility, we treat this as subscription completion
		const callback = this.#subscribeCallbacks.get(msg.requestId);
		if (callback) {
			callback.reject(new Error(`PUBLISH_DONE: code=${msg.statusCode} reason=${msg.reasonPhrase}`));
		}
	}

	/**
	 * Handles a PUBLISH_NAMESPACE control message received on the control stream.
	 * @param msg - The PUBLISH_NAMESPACE message
	 */
	async handlePublishNamespace(_msg: PublishNamespace) {
		// TODO implement once Cloudflare supports it
	}

	/**
	 * Handles a PUBLISH_NAMESPACE_DONE control message received on the control stream.
	 * @param msg - The PUBLISH_NAMESPACE_DONE message
	 */
	async handlePublishNamespaceDone(_msg: PublishNamespaceDone) {
		// TODO implement once Cloudflare supports it
	}

	async handleSubscribeNamespaceOk(_msg: SubscribeNamespaceOk) {
		// TODO
	}

	async handleSubscribeNamespaceError(_msg: SubscribeNamespaceError) {
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
