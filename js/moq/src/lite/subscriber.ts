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
	 */
	announced(prefix = Path.empty()): Announced {
		const announced = new Announced();
		void this.#runAnnounced(announced, prefix);
		return announced;
	}

	async #runAnnounced(announced: Announced, prefix: Path.Valid): Promise<void> {
		console.debug(`announced: prefix=${prefix}`);
		const msg = new AnnounceInterest(prefix);

		try {
			// Open a stream and send the announce interest.
			const stream = await Stream.open(this.#quic);
			await stream.writer.u8(StreamId.Announce);
			await msg.encode(stream.writer);

			// First, receive ANNOUNCE_INIT
			const init = await AnnounceInit.decode(stream.reader);

			// Process initial announcements
			for (const suffix of init.suffixes) {
				const path = Path.join(prefix, suffix);
				console.debug(`announced: broadcast=${path} active=true`);
				announced.append({ path, active: true });
			}

			// Then receive updates
			for (;;) {
				const announce = await Promise.race([Announce.decodeMaybe(stream.reader), announced.closed]);
				if (!announce) break;
				if (announce instanceof Error) throw announce;

				const path = Path.join(prefix, announce.suffix);

				console.debug(`announced: broadcast=${path} active=${announce.active}`);
				announced.append({ path, active: announce.active });
			}

			announced.close();
		} catch (err: unknown) {
			announced.close(error(err));
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

			await Promise.race([stream.reader.closed, request.track.closed]);

			request.track.close();
			stream.close();
			console.debug(`subscribe close: id=${id} broadcast=${broadcast} track=${request.track.name}`);
		} catch (err) {
			const e = error(err);
			request.track.close(e);
			console.warn(
				`subscribe error: id=${id} broadcast=${broadcast} track=${request.track.name} error=${e.message}`,
			);
			stream.abort(e);
		} finally {
			this.#subscribes.delete(id);
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
			stream.stop(new Error("cancel"));
		} catch (err: unknown) {
			const e = error(err);
			producer.close(e);
			stream.stop(e);
		}
	}

	close() {
		for (const track of this.#subscribes.values()) {
			track.close();
		}

		this.#subscribes.clear();
	}
}
