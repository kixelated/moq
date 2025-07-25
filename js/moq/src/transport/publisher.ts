import { AnnouncedProducer } from "../announced";
import type { BroadcastConsumer } from "../broadcast";
import type { GroupConsumer } from "../group";
import * as Path from "../path";
import { Writer } from "../stream";
import type { TrackConsumer } from "../track";
import { error } from "../util/error";
import { type Announce, AnnounceError, type AnnounceOk, type Unannounce } from "./announce";
import * as Control from "./control";
import { ObjectStatus, ObjectStream, StreamHeaderSubgroup, StreamType, writeStreamType } from "./object";
import { type Subscribe, SubscribeError, SubscribeOk, type Unsubscribe } from "./subscribe";
import { TrackStatus, type TrackStatusRequest } from "./track";

/**
 * Handles publishing broadcasts using moq-transport protocol with lite-compatibility restrictions.
 *
 * @internal
 */
export class Publisher {
	#quic: WebTransport;
	#controlWriter: Writer;

	// TODO this will store every announce/unannounce message, which will grow unbounded.
	// We should remove any cached announcements on unannounce, etc.
	#announced = new AnnouncedProducer();

	// Our published broadcasts.
	#broadcasts: Map<Path.Valid, BroadcastConsumer> = new Map();

	/**
	 * Creates a new Publisher instance.
	 * @param quic - The WebTransport session to use
	 * @param controlWriter - The control stream writer for sending control messages
	 *
	 * @internal
	 */
	constructor(quic: WebTransport, controlWriter: Writer) {
		this.#quic = quic;
		this.#controlWriter = controlWriter;
	}

	/**
	 * Gets a broadcast reader for the specified broadcast.
	 * @param name - The name of the broadcast to consume
	 * @returns A BroadcastConsumer instance or undefined if not found
	 */
	consume(namespace: Path.Valid): BroadcastConsumer | undefined {
		return this.#broadcasts.get(namespace)?.clone();
	}

	/**
	 * Publishes a broadcast with any associated tracks.
	 * @param name - The broadcast to publish
	 */
	publish(name: Path.Valid, broadcast: BroadcastConsumer) {
		this.#broadcasts.set(name, broadcast);
		void this.#runPublish(name, broadcast);
	}

	async #runPublish(name: Path.Valid, broadcast: BroadcastConsumer) {
		try {
			this.#announced.write({
				name,
				active: true,
			});

			console.debug(`announce: broadcast=${name} active=true`);

			// Wait until the broadcast is closed, then remove it from the lookup.
			await broadcast.closed();

			console.debug(`announce: broadcast=${name} active=false`);
		} catch (err: unknown) {
			console.warn(`announce: broadcast=${name} error=${error(err)}`);
		} finally {
			broadcast.close();

			this.#broadcasts.delete(name);

			this.#announced.write({
				name,
				active: false,
			});
		}
	}

	/**
	 * Handles a SUBSCRIBE control message received on the control stream.
	 * @param msg - The subscribe message
	 *
	 * @internal
	 */
	async handleSubscribe(msg: Subscribe) {
		// Validate that the subscription uses only lite-compatible features
		this.#validateSubscription(msg);

		// Convert track namespace/name to broadcast path (moq-lite compatibility)
		const broadcastPath = Path.from(...msg.trackNamespace);
		const broadcast = this.#broadcasts.get(broadcastPath);

		if (!broadcast) {
			console.debug(`publish unknown: broadcast=${broadcastPath}`);
			const errorMsg = new SubscribeError(
				msg.subscribeId,
				404, // Not found
				"Broadcast not found",
				msg.trackAlias,
			);
			await Control.write(this.#controlWriter, errorMsg);
			return;
		}

		const track = broadcast.subscribe(msg.trackName, msg.subscriberPriority);

		// Send SUBSCRIBE_OK response on control stream
		const okMsg = new SubscribeOk(
			msg.subscribeId,
			3600000n, // 1 hour expiry (arbitrary)
			msg.groupOrder,
			true, // content exists
		);
		await Control.write(this.#controlWriter, okMsg);

		console.debug(`publish ok: broadcast=${broadcastPath} track=${track.name}`);

		// Start sending track data using ObjectStream (Subgroup delivery mode only)
		void this.#runTrack(msg.subscribeId, msg.trackAlias, broadcastPath, track);
	}

	/**
	 * Validates that a subscription request uses only lite-compatible features.
	 * @param msg - The subscribe message to validate
	 * @throws Error if unsupported features are detected
	 */
	#validateSubscription(msg: Subscribe): void {
		// Check group order - we only support the default
		if (msg.groupOrder !== 0) {
			throw new Error(`MOQLITE_INCOMPATIBLE: Non-default group order not supported: ${msg.groupOrder}`);
		}

		// Check filter type - for lite compatibility, we only support basic subscriptions
		if (msg.filterType !== 0) {
			throw new Error(`MOQLITE_INCOMPATIBLE: Subscription filters not supported in lite mode: ${msg.filterType}`);
		}
	}

	/**
	 * Runs a track and sends its data using ObjectStream messages.
	 * @param subscribeId - The subscription ID
	 * @param trackAlias - The track alias
	 * @param broadcast - The broadcast name
	 * @param track - The track to run
	 *
	 * @internal
	 */
	async #runTrack(subscribeId: bigint, trackAlias: bigint, broadcast: Path.Valid, track: TrackConsumer) {
		try {
			for (;;) {
				const next = track.nextGroup();
				const group = await Promise.race([next]);
				if (!group) {
					next.then((group) => group?.close());
					break;
				}

				void this.#runGroup(subscribeId, trackAlias, group);
			}

			console.debug(`publish close: broadcast=${broadcast} track=${track.name}`);
		} catch (err: unknown) {
			const e = error(err);
			console.warn(`publish error: broadcast=${broadcast} track=${track.name} error=${e}`);
		} finally {
			track.close();
		}
	}

	/**
	 * Runs a group and sends its frames using ObjectStream (Subgroup delivery mode).
	 * @param subscribeId - The subscription ID
	 * @param trackAlias - The track alias
	 * @param group - The group to run
	 *
	 * @internal
	 */
	async #runGroup(subscribeId: bigint, trackAlias: bigint, group: GroupConsumer) {
		try {
			// Create a new unidirectional stream for this group
			const stream = await Writer.open(this.#quic);

			// Write stream type for STREAM_HEADER_SUBGROUP
			await writeStreamType(stream, StreamType.StreamHeaderSubgroup);

			// Write STREAM_HEADER_SUBGROUP
			const header = new StreamHeaderSubgroup(
				subscribeId,
				trackAlias,
				BigInt(group.id), // groupId
				0n, // objectSendOrder (we use 0 for all objects as we send in order)
			);
			await header.encode(stream);

			try {
				let objectId = 0n;
				for (;;) {
					const frame = await Promise.race([group.nextFrame(), stream.closed()]);
					if (!frame) break;

					// Write each frame as an object
					const obj = new ObjectStream(objectId, ObjectStatus.Normal, frame);
					await obj.encode(stream);
					objectId++;
				}

				// Send end of group marker
				const endOfGroup = new ObjectStream(objectId, ObjectStatus.EndOfGroup, new Uint8Array(0));
				await endOfGroup.encode(stream);

				stream.close();
			} catch (err: unknown) {
				stream.reset(error(err));
			}
		} finally {
			group.close();
		}
	}

	/**
	 * Handles an ANNOUNCE control message received on the control stream.
	 * @param msg - The announce message
	 */
	async handleAnnounce(msg: Announce) {
		console.warn(`MOQLITE_INCOMPATIBLE: Received ANNOUNCE for namespace: ${msg.trackNamespace}`);
		// moq-lite doesn't support track namespace announcements
		const errorMsg = new AnnounceError(
			msg.trackNamespace,
			501, // Not implemented
			"ANNOUNCE not supported in moq-lite compatibility mode",
		);
		await Control.write(this.#controlWriter, errorMsg);
	}

	/**
	 * Handles an UNANNOUNCE control message received on the control stream.
	 * @param msg - The unannounce message
	 */
	async handleUnannounce(msg: Unannounce) {
		console.warn(`MOQLITE_INCOMPATIBLE: Received UNANNOUNCE for namespace: ${msg.trackNamespace}`);
		// moq-lite doesn't support track namespace announcements, so nothing to unannounce
	}

	/**
	 * Handles a TRACK_STATUS_REQUEST control message received on the control stream.
	 * @param msg - The track status request message
	 */
	async handleTrackStatusRequest(msg: TrackStatusRequest) {
		console.warn(`MOQLITE_INCOMPATIBLE: Received TRACK_STATUS_REQUEST for ${msg.trackNamespace}/${msg.trackName}`);
		// moq-lite doesn't support track status requests
		const statusMsg = new TrackStatus(msg.trackNamespace, msg.trackName, TrackStatus.STATUS_NOT_FOUND, 0n, 0n);
		await Control.write(this.#controlWriter, statusMsg);
	}

	/**
	 * Handles an UNSUBSCRIBE control message received on the control stream.
	 * @param msg - The unsubscribe message
	 */
	async handleUnsubscribe(msg: Unsubscribe) {
		console.debug(`unsubscribe received: id=${msg.subscribeId}`);
		// In moq-transport, UNSUBSCRIBE is sent by subscribers to stop receiving media
		// For now, we simply acknowledge it but don't actively manage subscriptions
		// TODO: Cancel any active object streams for this subscription
	}

	/**
	 * Handles an ANNOUNCE_OK control message received on the control stream.
	 * @param msg - The announce ok message
	 */
	async handleAnnounceOk(msg: AnnounceOk) {
		console.warn(`MOQLITE_INCOMPATIBLE: Received ANNOUNCE_OK for namespace: ${msg.trackNamespace}`);
		// In moq-transport, ANNOUNCE_OK is sent by subscribers to acknowledge ANNOUNCE
		// moq-lite doesn't support track namespace announcements
	}

	/**
	 * Handles an ANNOUNCE_ERROR control message received on the control stream.
	 * @param msg - The announce error message
	 */
	async handleAnnounceError(msg: AnnounceError) {
		console.warn(
			`MOQLITE_INCOMPATIBLE: Received ANNOUNCE_ERROR for namespace: ${msg.trackNamespace}, error: ${msg.errorCode} - ${msg.reasonPhrase}`,
		);
		// In moq-transport, ANNOUNCE_ERROR is sent by subscribers to reject ANNOUNCE
		// moq-lite doesn't support track namespace announcements
	}
}
