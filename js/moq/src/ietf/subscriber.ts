import { Announced } from "../announced.ts";
import { Broadcast, type TrackRequest } from "../broadcast.ts";
import { Group } from "../group.ts";
import * as Path from "../path.js";
import type { Reader } from "../stream.ts";
import type { Track } from "../track.ts";
import { error } from "../util/error.ts";
import type * as Control from "./control.ts";
import {
	Fetch,
	FetchCancel,
	type FetchError,
	type FetchHeader,
	FetchObject,
	type FetchOk,
	FetchType,
} from "./fetch.ts";
import { type GroupHeader, GroupObject, GroupOrder } from "./group.ts";
import { type Publish, PublishError } from "./publish.ts";
import type { PublishNamespace, PublishNamespaceDone } from "./publish_namespace.ts";
import { type PublishDone, Subscribe, type SubscribeError, type SubscribeOk, Unsubscribe } from "./subscribe.ts";
import {
	SubscribeNamespace,
	type SubscribeNamespaceError,
	type SubscribeNamespaceOk,
	UnsubscribeNamespace,
} from "./subscribe_namespace.ts";
import type { TrackStatus } from "./track.ts";

interface FetchState {
	track: Track;
	resolve: (group?: Group) => void;
	reject: (error: Error) => void;
}

interface SubscribeState {
	track: Track;
	fetch: Promise<Group | undefined>;
	resolve: (ok: SubscribeOk) => void;
	reject: (error: Error) => void;
}

/**
 * Handles subscribing to broadcasts using moq-transport protocol with lite-compatibility restrictions.
 *
 * @internal
 */
export class Subscriber {
	#control: Control.Stream;

	// Any currently active announcements.
	#announced = new Set<Path.Valid>();

	// Any consumers that want each new announcement.
	#announcedConsumers = new Set<Announced>();

	// Our subscribed tracks - keyed by request ID
	#subscribes = new Map<bigint, SubscribeState>();

	// Active fetches - keyed by request ID
	#fetches = new Map<bigint, FetchState>();

	// A map of track aliases to request IDs
	#trackAliases = new Map<bigint, bigint>();

	/**
	 * Creates a new Subscriber instance.
	 * @param quic - The WebTransport session to use
	 * @param control - The control stream writer for sending control messages
	 *
	 * @internal
	 */
	constructor(control: Control.Stream) {
		this.#control = control;
	}

	/**
	 * Gets an announced reader for the specified prefix.
	 * @param prefix - The prefix for announcements
	 * @returns An AnnounceConsumer instance
	 */
	announced(prefix = Path.empty()): Announced {
		const announced = new Announced(prefix);
		for (const active of this.#announced) {
			if (!active.startsWith(prefix)) continue;

			announced.append({
				path: active,
				active: true,
			});
		}

		this.#announcedConsumers.add(announced);
		this.#runAnnounced(announced, prefix).finally(() => {
			this.#announcedConsumers.delete(announced);
		});

		return announced;
	}

	async #runAnnounced(announced: Announced, prefix: Path.Valid) {
		const requestId = await this.#control.nextRequestId();
		if (requestId === undefined) return;

		try {
			this.#control.write(new SubscribeNamespace(prefix, requestId));
			await announced.closed;
		} finally {
			this.#control.write(new UnsubscribeNamespace(requestId));
		}
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
		const requestId = await this.#control.nextRequestId();
		const fetchRequestId = await this.#control.nextRequestId();
		if (requestId === undefined || fetchRequestId === undefined) return;

		try {
			// Unblock when the joining fetch is complete.
			const fetchPromise = new Promise<Group | undefined>((resolve, reject) => {
				this.#fetches.set(fetchRequestId, { track: request.track, resolve, reject });
			});

			// Send SUBSCRIBE message on control stream and wait for response
			const subscribePromise = new Promise<SubscribeOk>((resolve, reject) => {
				this.#subscribes.set(requestId, { track: request.track, fetch: fetchPromise, resolve, reject });
			});

			const msg = new Subscribe(requestId, broadcast, request.track.name, request.priority);
			await this.#control.write(msg);

			// We also need to issue a joining fetch otherwise we will miss parts of the first group.
			// THIS IS EXTREMELY ANNOYING.
			const fetch = new Fetch(fetchRequestId, request.priority, GroupOrder.Descending, {
				type: FetchType.Relative,
				subscribeId: requestId,
				groupOffset: 0,
			});
			await this.#control.write(fetch);

			// Wait for the SUBSCRIBE_OK so we know the track alias.
			const ok = await subscribePromise;

			try {
				this.#trackAliases.set(ok.trackAlias, requestId);

				await request.track.closed;

				// TODO only send this if needed.
				const fetchCancel = new FetchCancel(fetchRequestId);
				await this.#control.write(fetchCancel);

				const msg = new Unsubscribe(requestId);
				await this.#control.write(msg);
			} finally {
				this.#trackAliases.delete(ok.trackAlias);
			}
		} catch (err) {
			const e = error(err);
			request.track.close(e);
		} finally {
			this.#subscribes.delete(requestId);
			this.#fetches.delete(requestId);
		}
	}

	/**
	 * Handles a SUBSCRIBE_OK control message received on the control stream.
	 * @param msg - The SUBSCRIBE_OK message
	 *
	 * @internal
	 */
	async handleSubscribeOk(msg: SubscribeOk) {
		const subscribe = this.#subscribes.get(msg.requestId);
		if (!subscribe) {
			console.warn("handleSubscribeOk unknown requestId", msg.requestId);
			return;
		}

		subscribe.resolve(msg);
	}

	/**
	 * Handles a SUBSCRIBE_ERROR control message received on the control stream.
	 * @param msg - The SUBSCRIBE_ERROR message
	 *
	 * @internal
	 */
	async handleSubscribeError(msg: SubscribeError) {
		const subscribe = this.#subscribes.get(msg.requestId);
		if (!subscribe) {
			console.warn("handleSubscribeError unknown requestId", msg.requestId);
			return;
		}

		subscribe.reject(new Error(`SUBSCRIBE_ERROR: code=${msg.errorCode} reason=${msg.reasonPhrase}`));
	}

	/**
	 * Handles an ObjectStream message (moq-transport equivalent of moq-lite Group).
	 * @param msg - The ObjectStream message
	 * @param stream - The stream to read object data from
	 *
	 * @internal
	 */
	async handleGroup(group: GroupHeader, stream: Reader) {
		if (group.subGroupId !== 0) {
			throw new Error(`subgroup ID is not supported: ${group.subGroupId}`);
		}

		let requestId = this.#trackAliases.get(group.trackAlias);
		if (requestId === undefined) {
			// Just hope the track alias is the request ID
			requestId = group.trackAlias;
			console.warn("unknown track alias, using request ID");
		}

		const subscribe = this.#subscribes.get(requestId);
		if (!subscribe) {
			throw new Error(
				`unknown subscribe: trackAlias=${group.trackAlias} requestId=${this.#trackAliases.get(group.trackAlias)}`,
			);
		}
		let producer: Group;

		// Ugh we have to make sure the joining fetch is complete.
		const first = await subscribe.fetch;
		if (first && first.sequence === group.groupId) {
			// Continue where the joining fetch left off.
			producer = first;
		} else {
			producer = new Group(group.groupId);
			subscribe.track.writeGroup(producer);
		}

		try {
			// Read objects from the stream until end of group
			for (;;) {
				const done = await Promise.race([stream.done(), producer.closed, subscribe.track.closed]);
				if (done !== false) break;

				const frame = await GroupObject.decode(stream, group.flags);
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

	// we don't support publish, so send PUBLISH_ERROR
	async handlePublish(msg: Publish) {
		// TODO technically, we should send PUBLISH_OK if we had a SUBSCRIBE in flight for the same track.
		// Otherwise, the peer will SUBSCRIBE_ERROR because duplicate subscriptions are not allowed :(
		const err = new PublishError(msg.requestId, 500, "publish not supported");
		await this.#control.write(err);
	}

	/**
	 * Handles a PUBLISH_DONE control message received on the control stream.
	 * @param msg - The PUBLISH_DONE message
	 */
	async handlePublishDone(msg: PublishDone) {
		// For lite compatibility, we treat this as subscription completion
		const subscribe = this.#subscribes.get(msg.requestId);
		if (!subscribe) {
			console.warn("handlePublishDone unknown requestId", msg.requestId);
			return;
		}

		subscribe.track.close();
	}

	/**
	 * Handles a PUBLISH_NAMESPACE control message received on the control stream.
	 * @param msg - The PUBLISH_NAMESPACE message
	 */
	async handlePublishNamespace(msg: PublishNamespace) {
		if (this.#announced.has(msg.trackNamespace)) {
			console.warn("duplicate PUBLISH_NAMESPACE message");
			return;
		}

		this.#announced.add(msg.trackNamespace);

		for (const consumer of this.#announcedConsumers) {
			consumer.append({
				path: msg.trackNamespace,
				active: true,
			});
		}
	}

	/**
	 * Handles a PUBLISH_NAMESPACE_DONE control message received on the control stream.
	 * @param msg - The PUBLISH_NAMESPACE_DONE message
	 */
	async handlePublishNamespaceDone(msg: PublishNamespaceDone) {
		if (!this.#announced.has(msg.trackNamespace)) {
			console.warn("unknown PUBLISH_NAMESPACE_DONE message");
			return;
		}

		this.#announced.delete(msg.trackNamespace);

		for (const consumer of this.#announcedConsumers) {
			consumer.append({
				path: msg.trackNamespace,
				active: false,
			});
		}
	}

	async handleSubscribeNamespaceOk(_msg: SubscribeNamespaceOk) {
		// Don't care
	}

	async handleSubscribeNamespaceError(_msg: SubscribeNamespaceError) {
		throw new Error("SUBSCRIBE_NAMESPACE_ERROR messages are not supported");
	}

	/**
	 * Handles a TRACK_STATUS control message received on the control stream.
	 * @param msg - The TRACK_STATUS message
	 */
	async handleTrackStatus(_msg: TrackStatus) {
		throw new Error("TRACK_STATUS messages are not supported");
	}

	async handleFetch(header: FetchHeader, stream: Reader) {
		const fetch = this.#fetches.get(header.requestId);
		if (!fetch) {
			throw new Error(`unknown fetch: requestId=${header.requestId}`);
		}

		this.#fetches.delete(header.requestId);
		const { track, resolve, reject } = fetch;

		try {
			let group: Group | undefined;
			let nextObjectId = 0;

			for (;;) {
				const done = await Promise.race([stream.done(), track.closed]);
				if (done !== false) break;

				const frame = await FetchObject.decode(stream);
				if (frame.payload === undefined) break;

				if (group === undefined) {
					group = new Group(frame.groupId);
					track.writeGroup(group);
				} else if (group.sequence !== frame.groupId) {
					throw new Error(`fetch returned multiple groups: ${group.sequence} !== ${frame.groupId}`);
				}

				if (frame.objectId !== nextObjectId) {
					throw new Error(`fetch returned object ID out of order: ${frame.objectId} !== ${nextObjectId}`);
				}

				if (frame.subgroupId !== 0) {
					throw new Error(`fetch returned subgroup ID: ${frame.subgroupId}`);
				}

				nextObjectId++;

				track.writeFrame(frame.payload);
			}

			// Send the remainder of the group to the callback.
			resolve(group);
		} catch (err: unknown) {
			const e = error(err);
			reject(e);
		}
	}

	handleFetchOk(msg: FetchOk) {
		const fetch = this.#fetches.get(msg.requestId);
		if (!fetch) {
			throw new Error(`unknown fetch: requestId=${msg.requestId}`);
		}

		if (msg.endOfTrack) {
			console.warn("TODO handle end of track");
		}
	}

	handleFetchError(msg: FetchError) {
		const fetch = this.#fetches.get(msg.requestId);
		if (!fetch) {
			throw new Error(`unknown fetch: requestId=${msg.requestId}`);
		}

		fetch.reject(new Error(`FETCH_ERROR: code=${msg.errorCode} reason=${msg.reasonPhrase}`));
	}
}
