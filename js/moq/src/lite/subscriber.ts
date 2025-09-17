import { Announced } from "../announced.ts";
import { Broadcast, type TrackRequest } from "../broadcast.ts";
import { Group } from "../group.ts";
import * as Path from "../path.ts";
import { type Reader, Stream } from "../stream.ts";
import type { Track } from "../track.ts";
import { error } from "../util/error.ts";
import { Announce, AnnounceInit, AnnounceInterest } from "./announce.ts";
import type { Group as GroupMessage } from "./group.ts";
import { StreamId } from "./stream.ts";
import { Subscribe, SubscribeOk } from "./subscribe.ts";

/**
 * Handles subscribing to broadcasts and managing their lifecycle.
 *
 * @internal
 */
export class Subscriber {
	#quic: WebTransport;

	// Our subscribed tracks.
	#subscribes = new Map<bigint, Track>();
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
	announced(prefix: Path.Valid = Path.empty()): Announced {
		console.debug(`announce please: prefix=${prefix}`);

		const announced = new Announced();
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
					announced.write({ name, active: true });
				}

				// Then receive updates
				for (;;) {
					const announce = await Announce.decodeMaybe(stream.reader);
					if (!announce) {
						break;
					}

					const name = Path.join(prefix, announce.suffix);

					console.debug(`announced: broadcast=${name} active=${announce.active}`);
					announced.write({ name, active: announce.active });
				}

				announced.close();
			} catch (err: unknown) {
				announced.close(error(err));
			}
		})();

		return announced;
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
		const id = this.#subscribeNext++;

		// Save the writer so we can append groups to it.
		this.#subscribes.set(id, request.track);

		console.debug(`subscribe start: id=${id} broadcast=${broadcast} track=${request.track.name}`);

		const msg = new Subscribe(id, broadcast, request.track.name, request.priority);

		const stream = await Stream.open(this.#quic);
		await stream.writer.u8(StreamId.Subscribe);
		await msg.encode(stream.writer);

		try {
			await SubscribeOk.decode(stream.reader);
			console.debug(`subscribe ok: id=${id} broadcast=${broadcast} track=${request.track.name}`);

			await Promise.race([stream.reader.closed(), request.track.closed]);

			request.track.close();
			console.debug(`subscribe close: id=${id} broadcast=${broadcast} track=${request.track.name}`);
		} catch (err) {
			const e = error(err);
			request.track.close(e);
			console.warn(
				`subscribe error: id=${id} broadcast=${broadcast} track=${request.track.name} error=${e.message}`,
			);
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
	async runGroup(group: GroupMessage, stream: Reader) {
		const subscribe = this.#subscribes.get(group.subscribe);
		if (!subscribe) {
			if (group.subscribe >= this.#subscribeNext) {
				throw new Error(`unknown subscription: id=${group.subscribe}`);
			}

			return;
		}

		const producer = new Group(group.sequence);
		subscribe.writeGroup(producer);

		try {
			for (;;) {
				const done = await Promise.race([stream.done(), subscribe.closed, producer.closed]);
				if (done !== false) break;

				const size = await stream.u53();
				const payload = await stream.read(size);
				if (!payload) break;

				producer.writeFrame(payload);
			}

			producer.close();
		} catch (err: unknown) {
			producer.close(error(err));
		}
	}

	close() {
		for (const track of this.#subscribes.values()) {
			track.close();
		}

		this.#subscribes.clear();
	}
}
