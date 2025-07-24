import { AnnouncedProducer } from "../announced";
import type { BroadcastConsumer } from "../broadcast";
import type { GroupConsumer } from "../group";
import * as Path from "../path";
import { type Stream, Writer } from "../stream";
import type { TrackConsumer } from "../track";
import { error } from "../util/error";
import * as Lite from ".";

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
	 * Gets a broadcast reader for the specified broadcast.
	 * @param name - The name of the broadcast to consume
	 * @returns A BroadcastConsumer instance or undefined if not found
	 */
	consume(name: Path.Valid): BroadcastConsumer | undefined {
		return this.#broadcasts.get(name)?.clone();
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
	 * Handles an announce interest message.
	 * @param msg - The announce interest message
	 * @param stream - The stream to write announcements to
	 *
	 * @internal
	 */
	async runAnnounce(msg: Lite.AnnounceInterest, stream: Stream) {
		const consumer = this.#announced.consume(msg.prefix);

		// Send ANNOUNCE_INIT as the first message with all currently active paths
		const activePaths: Path.Valid[] = [];
		for (const [name] of this.#broadcasts) {
			const suffix = Path.stripPrefix(msg.prefix, name);
			if (suffix === null) continue;
			activePaths.push(suffix);
		}

		const init = new Lite.AnnounceInit(activePaths);
		await init.encode(stream.writer);

		// Then send updates as they occur
		for (;;) {
			const announcement = await consumer.next();
			if (!announcement) break;

			const wire = new Lite.Announce(announcement.name, announcement.active);
			await wire.encode(stream.writer);
		}
	}

	/**
	 * Handles a subscribe message.
	 * @param msg - The subscribe message
	 * @param stream - The stream to write track data to
	 *
	 * @internal
	 */
	async runSubscribe(msg: Lite.Subscribe, stream: Stream) {
		const broadcast = this.#broadcasts.get(msg.broadcast);
		if (!broadcast) {
			console.debug(`publish unknown: broadcast=${msg.broadcast}`);
			stream.writer.reset(new Error("not found"));
			return;
		}

		const track = broadcast.subscribe(msg.track, msg.priority);
		const info = new Lite.SubscribeOk(track.priority);
		await info.encode(stream.writer);

		console.debug(`publish ok: broadcast=${msg.broadcast} track=${track.name}`);

		const serving = this.#runTrack(msg.id, msg.broadcast, track, stream.writer);

		for (;;) {
			const decode = Lite.SubscribeUpdate.decode_maybe(stream.reader);

			const result = await Promise.any([serving, decode]);
			if (!result) break;

			if (result instanceof Lite.SubscribeUpdate) {
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
					next.then((group) => group?.close());
					break;
				}

				void this.#runGroup(sub, group);
			}

			console.debug(`publish close: broadcast=${broadcast} track=${track.name}`);
			stream.close();
		} catch (err: unknown) {
			const e = error(err);
			console.warn(`publish error: broadcast=${broadcast} track=${track.name} error=${e}`);
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
		const msg = new Lite.Group(sub, group.id);
		try {
			const stream = await Writer.open(this.#quic);
			await stream.u8(Lite.Group.StreamID);
			await msg.encode(stream);
			stream.close();

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
}
