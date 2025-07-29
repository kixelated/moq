import { AnnouncedProducer } from "../announced";
import type { BroadcastConsumer } from "../broadcast";
import type { GroupConsumer } from "../group";
import * as Path from "../path";
import { type Stream, Writer } from "../stream";
import type { TrackConsumer } from "../track";
import { error } from "../util/error";
import { Announce, AnnounceInit, type AnnounceInterest } from "./announce";
import { Group } from "./group";
import { type Subscribe, SubscribeOk, SubscribeUpdate } from "./subscribe";

/**
 * Handles publishing broadcasts and managing their lifecycle.
 *
 * @internal
 */
export class Publisher {
	#quic: WebTransport;

	// TODO this will store every announce/unannounce message, which will grow unbounded.
	// We should remove any cached announcements on unannounce, etc.
	#announced = new AnnouncedProducer();

	// Our published broadcasts.
	#broadcasts = new Map<Path.Valid, BroadcastConsumer>();

	/**
	 * Creates a new Publisher instance.
	 * @param quic - The WebTransport session to use
	 *
	 * @internal
	 */
	constructor(quic: WebTransport) {
		this.#quic = quic;
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

			// Wait until the broadcast is closed, then remove it from the lookup.
			await broadcast.closed();
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
	 * Handles an announce interest message.
	 * @param msg - The announce interest message
	 * @param stream - The stream to write announcements to
	 *
	 * @internal
	 */
	async runAnnounce(msg: AnnounceInterest, stream: Stream) {
		const consumer = this.#announced.consume(msg.prefix);

		// Send ANNOUNCE_INIT as the first message with all currently active paths
		const activePaths: Path.Valid[] = [];

		// Make a resolved promise so we can avoid blocking.
		// This abuses the fact that Promise.race will prioritize the first resolved promise.
		const timeout = Promise.resolve();

		let next = consumer.next();

		for (;;) {
			const announcement = await Promise.race([next, timeout]);
			if (!announcement) break;

			console.debug(`announce: broadcast=${announcement.name} active=${announcement.active} init=true`);

			const suffix = Path.stripPrefix(msg.prefix, announcement.name);
			if (suffix === null) throw new Error("invalid suffix");

			const index = activePaths.indexOf(suffix);
			if (announcement.active) {
				if (index !== -1) throw new Error("duplicate announce");
				activePaths.push(suffix);
			} else {
				if (index === -1) throw new Error("unknown announce");
				activePaths.splice(index, 1);
			}

			next = consumer.next();
		}

		const init = new AnnounceInit(activePaths);
		await init.encode(stream.writer);

		// Then send updates as they occur
		for (;;) {
			const announcement = await next;
			if (!announcement) break;

			console.debug(`announce: broadcast=${announcement.name} active=${announcement.active} init=false`);

			const wire = new Announce(announcement.name, announcement.active);
			await wire.encode(stream.writer);

			next = consumer.next();
		}

		consumer.close();
	}

	/**
	 * Handles a subscribe message.
	 * @param msg - The subscribe message
	 * @param stream - The stream to write track data to
	 *
	 * @internal
	 */
	async runSubscribe(msg: Subscribe, stream: Stream) {
		const broadcast = this.#broadcasts.get(msg.broadcast);
		if (!broadcast) {
			console.debug(`publish unknown: broadcast=${msg.broadcast}`);
			stream.writer.reset(new Error("not found"));
			return;
		}

		const track = broadcast.subscribe(msg.track, msg.priority);
		const info = new SubscribeOk(track.priority);
		await info.encode(stream.writer);

		console.debug(`publish ok: broadcast=${msg.broadcast} track=${track.name}`);

		const serving = this.#runTrack(msg.id, msg.broadcast, track, stream.writer);

		for (;;) {
			const decode = SubscribeUpdate.decodeMaybe(stream.reader);

			const result = await Promise.any([serving, decode]);
			if (!result) break;

			if (result instanceof SubscribeUpdate) {
				// TODO use the update
				console.warn("subscribe update not supported", result);
			}
		}
	}

	/**
	 * Runs a track and sends its data to the stream.
	 * @param sub - The subscription ID
	 * @param broadcast - The broadcast name
	 * @param track - The track to run
	 * @param stream - The stream to write to
	 *
	 * @internal
	 */
	async #runTrack(sub: bigint, broadcast: Path.Valid, track: TrackConsumer, stream: Writer) {
		try {
			for (;;) {
				const next = track.nextGroup();
				const group = await Promise.race([next, stream.closed()]);
				if (!group) {
					next.then((group) => group?.close()).catch(() => {});
					break;
				}

				void this.#runGroup(sub, group);
			}

			console.debug(`publish close: broadcast=${broadcast} track=${track.name}`);
			stream.close();
		} catch (err: unknown) {
			const e = error(err);
			console.warn(`publish error: broadcast=${broadcast} track=${track.name} error=${e.message}`);
			stream.reset(e);
		} finally {
			track.close();
		}
	}

	/**
	 * Runs a group and sends its frames to the stream.
	 * @param sub - The subscription ID
	 * @param group - The group to run
	 *
	 * @internal
	 */
	async #runGroup(sub: bigint, group: GroupConsumer) {
		const msg = new Group(sub, group.id);
		try {
			const stream = await Writer.open(this.#quic);
			await stream.u8(Group.StreamID);
			await msg.encode(stream);

			try {
				for (;;) {
					const frame = await Promise.race([group.nextFrame(), stream.closed()]);
					if (!frame) break;

					await stream.u53(frame.byteLength);
					await stream.write(frame);
				}

				stream.close();
			} catch (err: unknown) {
				stream.reset(error(err));
			}
		} finally {
			group.close();
		}
	}

	close() {
		this.#announced.close();

		for (const broadcast of this.#broadcasts.values()) {
			broadcast.close();
		}

		this.#broadcasts.clear();
	}
}
