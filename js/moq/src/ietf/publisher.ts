import type { Broadcast } from "../broadcast.ts";
import type { Group } from "../group.ts";
import type * as Path from "../path.ts";
import { Writer } from "../stream.ts";
import type { Track } from "../track.ts";
import { error } from "../util/error.ts";
import { Announce, type AnnounceCancel, type AnnounceError, type AnnounceOk, Unannounce } from "./announce.ts";
import type * as Control from "./control.ts";
import { Frame, Group as GroupMessage, writeStreamType } from "./object.ts";
import { type Subscribe, SubscribeDone, SubscribeError, SubscribeOk, type Unsubscribe } from "./subscribe.ts";
import type { SubscribeAnnounces, UnsubscribeAnnounces } from "./subscribe_announces.ts";
import { TrackStatus, type TrackStatusRequest } from "./track.ts";

/**
 * Handles publishing broadcasts using moq-transport protocol with lite-compatibility restrictions.
 *
 * @internal
 */
export class Publisher {
	#quic: WebTransport;
	#control: Control.Stream;

	// Our published broadcasts.
	#broadcasts: Map<Path.Valid, Broadcast> = new Map();

	/**
	 * Creates a new Publisher instance.
	 * @param quic - The WebTransport session to use
	 * @param control - The control stream writer for sending control messages
	 *
	 * @internal
	 */
	constructor(quic: WebTransport, control: Control.Stream) {
		this.#quic = quic;
		this.#control = control;
	}

	/**
	 * Publishes a broadcast with any associated tracks.
	 * @param name - The broadcast to publish
	 */
	publish(name: Path.Valid, broadcast: Broadcast) {
		this.#broadcasts.set(name, broadcast);
		void this.#runPublish(name, broadcast);
	}

	async #runPublish(name: Path.Valid, broadcast: Broadcast) {
		try {
			const announce = new Announce(name);
			await this.#control.write(announce);

			// Wait until the broadcast is closed, then remove it from the lookup.
			await broadcast.closed;

			const unannounce = new Unannounce(name);
			await this.#control.write(unannounce);
		} catch (err: unknown) {
			const e = error(err);
			console.warn(`announce failed: broadcast=${name} error=${e.message}`);
		} finally {
			broadcast.close();
			this.#broadcasts.delete(name);
		}
	}

	/**
	 * Handles a SUBSCRIBE control message received on the control stream.
	 * @param msg - The subscribe message
	 *
	 * @internal
	 */
	async handleSubscribe(msg: Subscribe) {
		// Convert track namespace/name to broadcast path (moq-lite compatibility)
		const name = msg.trackNamespace;
		const broadcast = this.#broadcasts.get(name);

		if (!broadcast) {
			const errorMsg = new SubscribeError(
				msg.subscribeId,
				404, // Not found
				"Broadcast not found",
				msg.trackAlias,
			);
			await this.#control.write(errorMsg);
			return;
		}

		const track = broadcast.subscribe(msg.trackName, msg.subscriberPriority);

		// Send SUBSCRIBE_OK response on control stream
		const okMsg = new SubscribeOk(msg.subscribeId);
		await this.#control.write(okMsg);

		// Start sending track data using ObjectStream (Subgroup delivery mode only)
		void this.#runTrack(msg.subscribeId, msg.trackAlias, track);
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
	async #runTrack(subscribeId: bigint, trackAlias: bigint, track: Track) {
		try {
			for (;;) {
				const group = await track.nextGroup();
				if (!group) break;
				void this.#runGroup(subscribeId, trackAlias, group);
			}

			const msg = new SubscribeDone(subscribeId, 200, "OK");
			await this.#control.write(msg);
		} catch (err: unknown) {
			const e = error(err);
			const msg = new SubscribeDone(subscribeId, 500, e.message);
			await this.#control.write(msg);
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
	async #runGroup(subscribeId: bigint, trackAlias: bigint, group: Group) {
		try {
			// Create a new unidirectional stream for this group
			const stream = await Writer.open(this.#quic);

			// Write stream type for STREAM_HEADER_SUBGROUP
			await writeStreamType(stream);

			// Write STREAM_HEADER_SUBGROUP
			const header = new GroupMessage(
				subscribeId,
				trackAlias,
				group.sequence,
				0, // publisherPriority
			);
			await header.encode(stream);

			try {
				let objectId = 0;
				for (;;) {
					const frame = await Promise.race([group.readFrame(), stream.closed]);
					if (!frame) break;

					// Write each frame as an object
					const obj = new Frame(objectId, frame);
					await obj.encode(stream);
					objectId++;
				}

				// Send end of group marker via an undefined payload
				const endOfGroup = new Frame(objectId);
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
	 * Handles a TRACK_STATUS_REQUEST control message received on the control stream.
	 * @param msg - The track status request message
	 */
	async handleTrackStatusRequest(msg: TrackStatusRequest) {
		// moq-lite doesn't support track status requests
		const statusMsg = new TrackStatus(msg.trackNamespace, msg.trackName, TrackStatus.STATUS_NOT_FOUND, 0n, 0n);
		await this.#control.write(statusMsg);
	}

	/**
	 * Handles an UNSUBSCRIBE control message received on the control stream.
	 * @param msg - The unsubscribe message
	 */
	async handleUnsubscribe(_msg: Unsubscribe) {
		// TODO
	}

	/**
	 * Handles an ANNOUNCE_OK control message received on the control stream.
	 * @param msg - The announce ok message
	 */
	async handleAnnounceOk(_msg: AnnounceOk) {
		// TODO
	}

	/**
	 * Handles an ANNOUNCE_ERROR control message received on the control stream.
	 * @param msg - The announce error message
	 */
	async handleAnnounceError(_msg: AnnounceError) {
		// TODO
	}

	/**
	 * Handles an ANNOUNCE_CANCEL control message received on the control stream.
	 * @param msg - The ANNOUNCE_CANCEL message
	 */
	async handleAnnounceCancel(_msg: AnnounceCancel) {
		// TODO
	}

	async handleSubscribeAnnounces(_msg: SubscribeAnnounces) {}

	async handleUnsubscribeAnnounces(_msg: UnsubscribeAnnounces) {}
}
