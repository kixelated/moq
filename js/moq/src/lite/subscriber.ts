import { type AnnouncedConsumer, AnnouncedProducer } from "../announced";
import { type BroadcastConsumer, BroadcastProducer } from "../broadcast";
import { GroupProducer } from "../group";
import * as Path from "../path";
import { type Reader, Stream } from "../stream";
import type { TrackProducer } from "../track";
import { error } from "../util/error";
import { Announce, AnnounceInit, AnnounceInterest } from "./announce";
import type { Group } from "./group";
import { StreamId } from "./stream";
import { Subscribe, SubscribeOk } from "./subscribe";

/**
 * Handles subscribing to broadcasts and managing their lifecycle.
 *
 * @internal
 */
export class Subscriber {
	#quic: WebTransport;

	// Our subscribed tracks.
	#subscribes = new Map<bigint, TrackProducer>();
	#subscribeNext = 0n;

	/**
	 * Creates a new Subscriber instance.
	 * @param quic - The WebTransport session to use
	 *
	 * @internal
	 */
	constructor(quic: WebTransport) {
		this.#quic = quic;
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

		const msg = new AnnounceInterest(prefix);

		(async () => {
			try {
				// Open a stream and send the announce interest.
				const stream = await Stream.open(this.#quic);
				await stream.writer.u8(StreamId.Announce);
				await msg.encode(stream.writer);

				// First, receive ANNOUNCE_INIT
				const init = await AnnounceInit.decode(stream.reader);

				// Process initial announcements
				for (const suffix of init.suffixes) {
					const name = Path.join(prefix, suffix);
					console.debug(`announced: broadcast=${name} active=true`);
					producer.write({ name, active: true });
				}

				// Then receive updates
				for (;;) {
					const announce = await Announce.decodeMaybe(stream.reader);
					if (!announce) {
						break;
					}

					const name = Path.join(prefix, announce.suffix);

					console.debug(`announced: broadcast=${name} active=${announce.active}`);
					producer.write({ name, active: announce.active });
				}

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
			// NOTE: We intentionally don't deduplicate because BUGS.
			// Perform the subscription in the background.
			this.#runSubscribe(broadcast, track);
		});

		// Close when the producer has no more consumers.
		producer.unused().finally(() => {
			producer.close();
		});

		return consumer;
	}

	async #runSubscribe(broadcast: Path.Valid, track: TrackProducer) {
		const id = this.#subscribeNext++;

		// Save the writer so we can append groups to it.
		this.#subscribes.set(id, track);

		console.debug(`subscribe start: id=${id} broadcast=${broadcast} track=${track.name}`);

		const msg = new Subscribe(id, broadcast, track.name, track.priority);

		const stream = await Stream.open(this.#quic);
		await stream.writer.u8(StreamId.Subscribe);
		await msg.encode(stream.writer);

		try {
			await SubscribeOk.decode(stream.reader);
			console.debug(`subscribe ok: id=${id} broadcast=${broadcast} track=${track.name}`);

			await Promise.race([stream.reader.closed(), track.unused()]);

			track.close();
			console.debug(`subscribe close: id=${id} broadcast=${broadcast} track=${track.name}`);
		} catch (err) {
			const e = error(err);
			track.abort(e);
			console.warn(`subscribe error: id=${id} broadcast=${broadcast} track=${track.name} error=${e.message}`);
		} finally {
			this.#subscribes.delete(id);
			stream.close();
		}
	}

	/**
	 * Handles a group message.
	 * @param group - The group message
	 * @param stream - The stream to read frames from
	 *
	 * @internal
	 */
	async runGroup(group: Group, stream: Reader) {
		const subscribe = this.#subscribes.get(group.subscribe);
		if (!subscribe) {
			console.warn(`unknown subscription: id=${group.subscribe}`);
			return;
		}

		const producer = new GroupProducer(group.sequence);
		subscribe.insertGroup(producer.consume());

		try {
			for (;;) {
				const done = await Promise.race([stream.done(), subscribe.unused(), producer.unused()]);
				if (done !== false) break;

				const size = await stream.u53();
				const payload = await stream.read(size);
				if (!payload) break;

				producer.writeFrame(payload);
			}

			producer.close();
		} catch (err: unknown) {
			producer.abort(error(err));
		}
	}

	close() {
		for (const track of this.#subscribes.values()) {
			track.close();
		}

		this.#subscribes.clear();
	}
}
