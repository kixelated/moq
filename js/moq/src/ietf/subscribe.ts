import type * as Path from "../path.ts";
import type { Reader, Writer } from "../stream.ts";
import * as Message from "./message.ts";
import * as Namespace from "./namespace.ts";
import { Parameters } from "./parameters.ts";

// we only support Group Order descending
const GROUP_ORDER = 0x02;

export class Subscribe {
	static id = 0x03;

	requestId: number;
	trackNamespace: Path.Valid;
	trackName: string;
	subscriberPriority: number;

	constructor(requestId: number, trackNamespace: Path.Valid, trackName: string, subscriberPriority: number) {
		this.requestId = requestId;
		this.trackNamespace = trackNamespace;
		this.trackName = trackName;
		this.subscriberPriority = subscriberPriority;
	}

	async #encode(w: Writer): Promise<void> {
		await w.u53(this.requestId);
		await Namespace.encode(w, this.trackNamespace);
		await w.string(this.trackName);
		await w.u8(this.subscriberPriority);
		await w.u8(GROUP_ORDER);
		await w.u8(1); // forward = true
		await w.u8(0x2); // LargestObject
		await w.u8(0); // no parameters
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<Subscribe> {
		return Message.decode(r, Subscribe.#decode);
	}

	static async #decode(r: Reader): Promise<Subscribe> {
		const requestId = await r.u53();
		const trackNamespace = await Namespace.decode(r);
		const trackName = await r.string();
		const subscriberPriority = await r.u8();

		const groupOrder = await r.u8();
		if (groupOrder !== 0 && groupOrder !== GROUP_ORDER) {
			throw new Error(`unsupported group order: ${groupOrder}`);
		}

		const forward = await r.u8();
		if (forward !== 1) {
			throw new Error(`unsupported forward value: ${forward}`);
		}

		const filterType = await r.u8();
		if (filterType !== 0x1 && filterType !== 0x2) {
			throw new Error(`unsupported filter type: ${filterType}`);
		}

		await Parameters.decode(r); // ignore parameters

		return new Subscribe(requestId, trackNamespace, trackName, subscriberPriority);
	}
}

export class SubscribeOk {
	static id = 0x04;

	requestId: number;

	constructor(requestId: number) {
		this.requestId = requestId;
	}

	async #encode(w: Writer): Promise<void> {
		await w.u53(this.requestId);
		await w.u53(this.requestId); // track_alias == request_id for now
		await w.u62(BigInt(0)); // expires = 0
		await w.u8(GROUP_ORDER);
		await w.u8(0); // no largest group/object
		await w.u8(0); // no parameters
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<SubscribeOk> {
		return Message.decode(r, SubscribeOk.#decode);
	}

	static async #decode(r: Reader): Promise<SubscribeOk> {
		const requestId = await r.u53();

		const trackAlias = await r.u53();
		if (trackAlias !== requestId) {
			throw new Error(`track aliases not supported`);
		}

		const expires = await r.u62();
		if (expires !== BigInt(0)) {
			throw new Error(`unsupported expires: ${expires}`);
		}

		await r.u8(); // Don't care about group order

		const contentExists = await r.u8();
		if (contentExists === 1) {
			// Ignore largest group/object
			await r.u62();
			await r.u62();
		}

		await Parameters.decode(r); // ignore parameters

		return new SubscribeOk(requestId);
	}
}

export class SubscribeError {
	static id = 0x05;

	requestId: number;
	errorCode: number;
	reasonPhrase: string;

	constructor(requestId: number, errorCode: number, reasonPhrase: string) {
		this.requestId = requestId;
		this.errorCode = errorCode;
		this.reasonPhrase = reasonPhrase;
	}

	async #encode(w: Writer): Promise<void> {
		await w.u53(this.requestId);
		await w.u62(BigInt(this.errorCode));
		await w.string(this.reasonPhrase);
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<SubscribeError> {
		return Message.decode(r, SubscribeError.#decode);
	}

	static async #decode(r: Reader): Promise<SubscribeError> {
		const requestId = await r.u53();
		const errorCode = Number(await r.u62());
		const reasonPhrase = await r.string();

		return new SubscribeError(requestId, errorCode, reasonPhrase);
	}
}

export class Unsubscribe {
	static readonly id = 0x0a;

	requestId: number;

	constructor(requestId: number) {
		this.requestId = requestId;
	}

	async #encode(w: Writer): Promise<void> {
		await w.u53(this.requestId);
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<Unsubscribe> {
		return Message.decode(r, Unsubscribe.#decode);
	}

	static async #decode(r: Reader): Promise<Unsubscribe> {
		const requestId = await r.u53();
		return new Unsubscribe(requestId);
	}
}

// In draft-14, this message is renamed from SUBSCRIBE_DONE to PUBLISH_DONE
export class PublishDone {
	static readonly id = 0x0b;

	requestId: number;
	statusCode: number;
	reasonPhrase: string;

	constructor(requestId: number, statusCode: number, reasonPhrase: string) {
		this.requestId = requestId;
		this.statusCode = statusCode;
		this.reasonPhrase = reasonPhrase;
	}

	async #encode(w: Writer): Promise<void> {
		await w.u53(this.requestId);
		await w.u62(BigInt(this.statusCode));
		await w.string(this.reasonPhrase);
		await w.u62(BigInt(0)); // stream_count = 0 (unsupported)
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<PublishDone> {
		return Message.decode(r, PublishDone.#decode);
	}

	static async #decode(r: Reader): Promise<PublishDone> {
		const requestId = await r.u53();
		const statusCode = Number(await r.u62());
		const reasonPhrase = await r.string();
		await r.u62(); // ignore stream_count

		return new PublishDone(requestId, statusCode, reasonPhrase);
	}
}

// Backward compatibility alias
export const SubscribeDone = PublishDone;
