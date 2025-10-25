import type { Broadcast } from "../broadcast.ts";
import type { Group } from "../group.ts";
import type * as Path from "../path.ts";
import { Writer } from "../stream.ts";
import type { Track } from "../track.ts";
import { error } from "../util/error.ts";
import type * as Control from "./control.ts";
import { Frame, Group as GroupMessage } from "./object.ts";
import {
	PublishNamespace,
	type PublishNamespaceCancel,
	PublishNamespaceDone,
	type PublishNamespaceError,
	type PublishNamespaceOk,
} from "./publish_namespace.ts";
import { PublishDone, type Subscribe, SubscribeError, SubscribeOk, type Unsubscribe } from "./subscribe.ts";
import type { SubscribeNamespace, UnsubscribeNamespace } from "./subscribe_namespace.ts";
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
	publish(path: Path.Valid, broadcast: Broadcast) {
		this.#broadcasts.set(path, broadcast);
		void this.#runPublish(path, broadcast);
	}

	async #runPublish(path: Path.Valid, broadcast: Broadcast) {
		try {
			const requestId = this.#control.requestId();
			const announce = new PublishNamespace(requestId, path);
			await this.#control.write(announce);

			// Wait until the broadcast is closed, then remove it from the lookup.
			await broadcast.closed;

			const unannounce = new PublishNamespaceDone(path);
			await this.#control.write(unannounce);
		} catch (err: unknown) {
			const e = error(err);
			console.warn(`announce failed: broadcast=${path} error=${e.message}`);
		} finally {
			broadcast.close();
			this.#broadcasts.delete(path);
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
				msg.requestId,
				404, // Not found
				"Broadcast not found",
			);
			await this.#control.write(errorMsg);
			return;
		}

		const track = broadcast.subscribe(msg.trackName, msg.subscriberPriority);

		// Send SUBSCRIBE_OK response on control stream
		const okMsg = new SubscribeOk(msg.requestId);
		await this.#control.write(okMsg);

		// Start sending track data using ObjectStream (Subgroup delivery mode only)
		void this.#runTrack(msg.requestId, track);
	}

	/**
	 * Runs a track and sends its data using ObjectStream messages.
	 * @param requestId - The subscription request ID (also used as track alias)
	 * @param track - The track to run
	 *
	 * @internal
	 */
	async #runTrack(requestId: number, track: Track) {
		try {
			for (;;) {
				const group = await track.nextGroup();
				if (!group) break;
				void this.#runGroup(requestId, group);
			}

			const msg = new PublishDone(requestId, 200, "OK");
			await this.#control.write(msg);
		} catch (err: unknown) {
			const e = error(err);
			const msg = new PublishDone(requestId, 500, e.message);
			await this.#control.write(msg);
		} finally {
			track.close();
		}
	}

	/**
	 * Runs a group and sends its frames using ObjectStream (Subgroup delivery mode).
	 * @param requestId - The subscription request ID (also used as track alias)
	 * @param group - The group to run
	 *
	 * @internal
	 */
	async #runGroup(requestId: number, group: Group) {
		try {
			// Create a new unidirectional stream for this group
			const stream = await Writer.open(this.#quic);

			// Write STREAM_HEADER_SUBGROUP
			const header = new GroupMessage(requestId, group.sequence, {
				hasExtensions: false,
				hasSubgroup: false,
				hasSubgroupObject: false,
				// Automatically end the group on stream FIN
				hasEnd: true,
			});
			await header.encode(stream);

			try {
				for (;;) {
					const frame = await Promise.race([group.readFrame(), stream.closed]);
					if (!frame) break;

					// Write each frame as an object
					const obj = new Frame(frame);
					await obj.encode(stream, header.flags);
				}

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
	 * Handles a PUBLISH_NAMESPACE_OK control message received on the control stream.
	 * @param msg - The publish namespace ok message
	 */
	async handlePublishNamespaceOk(_msg: PublishNamespaceOk) {
		// TODO
	}

	/**
	 * Handles a PUBLISH_NAMESPACE_ERROR control message received on the control stream.
	 * @param msg - The publish namespace error message
	 */
	async handlePublishNamespaceError(_msg: PublishNamespaceError) {
		// TODO
	}

	/**
	 * Handles a PUBLISH_NAMESPACE_CANCEL control message received on the control stream.
	 * @param msg - The PUBLISH_NAMESPACE_CANCEL message
	 */
	async handlePublishNamespaceCancel(_msg: PublishNamespaceCancel) {
		// TODO
	}

	async handleSubscribeNamespace(_msg: SubscribeNamespace) {}

	async handleUnsubscribeNamespace(_msg: UnsubscribeNamespace) {}
}
