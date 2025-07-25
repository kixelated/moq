import type * as Path from "../path";
import type { Reader, Writer } from "../stream";
import * as Namespace from "./namespace";

// We only support Latest Group (0x1)
const FILTER_TYPE = 0x01;

// we only support Group Order descending
const GROUP_ORDER = 0x02;

export class Subscribe {
	static id = 0x03;

	subscribeId: bigint;
	trackAlias: bigint;
	trackNamespace: Path.Valid;
	trackName: string;
	subscriberPriority: number;

	constructor(
		subscribeId: bigint,
		trackAlias: bigint,
		trackNamespace: Path.Valid,
		trackName: string, // technically bytes, but we're using strings for now
		subscriberPriority: number,
	) {
		this.subscribeId = subscribeId;
		this.trackAlias = trackAlias;
		this.trackNamespace = trackNamespace;
		this.trackName = trackName;
		this.subscriberPriority = subscriberPriority;
	}

	async encodeMessage(w: Writer): Promise<void> {
		await w.u62(this.subscribeId);
		await w.u62(this.trackAlias);
		await Namespace.encode(w, this.trackNamespace);
		await w.string(this.trackName);
		await w.u8(this.subscriberPriority);
		await w.u8(GROUP_ORDER);
		await w.u8(FILTER_TYPE);
		await w.u8(0); // no parameters
	}

	static async decodeMessage(r: Reader): Promise<Subscribe> {
		const subscribeId = await r.u62();
		const trackAlias = await r.u62();
		const trackNamespace = await Namespace.decode(r);
		const trackName = await r.string();
		const subscriberPriority = await r.u8();

		await r.u53(); // Don't care about group order

		const filterType = await r.u53();
		if (filterType !== FILTER_TYPE) {
			throw new Error(`unsupported filter type: ${filterType}`);
		}

		const numParams = await r.u8();
		if (numParams !== 0) {
			throw new Error(`SUBSCRIBE: parameters not supported: ${numParams}`);
		}

		return new Subscribe(
			subscribeId,
			trackAlias,
			trackNamespace,
			trackName,
			subscriberPriority,
		);
	}
}

export class SubscribeOk {
	static id = 0x04;

	subscribeId: bigint;

	// Largest group/object ID
	largest?: [bigint, bigint];

	constructor(subscribeId: bigint, largest?: [bigint, bigint]) {
		this.subscribeId = subscribeId;
		this.largest = largest;
	}

	async encodeMessage(w: Writer): Promise<void> {
		await w.u62(this.subscribeId);
		await w.u8(0);
		await w.u8(GROUP_ORDER);
		if (this.largest) {
			await w.u8(1);
			await w.u62(this.largest[0]);
			await w.u62(this.largest[1]);
		} else {
			await w.u8(0);
		}
		await w.u8(0); // no parameters
	}

	static async decodeMessage(r: Reader): Promise<SubscribeOk> {
		const subscribeId = await r.u62();

		const expires = await r.u53();
		if (expires !== 0) {
			throw new Error(`unsupported expires: ${expires}`);
		}

		await r.u53(); // Don't care about group order

		let largest: [bigint, bigint] | undefined;
		const contentExists = await r.u53();
		if (contentExists === 1) {
			largest = [await r.u62(), await r.u62()];
		}

		const numParams = await r.u8();
		if (numParams !== 0) {
			throw new Error(`SUBSCRIBE_OK: parameters not supported: ${numParams}`);
		}

		return new SubscribeOk(subscribeId, largest);
	}
}

export class SubscribeError {
	static id = 0x05;

	subscribeId: bigint;
	errorCode: number;
	reasonPhrase: string;
	trackAlias: bigint;

	constructor(subscribeId: bigint, errorCode: number, reasonPhrase: string, trackAlias: bigint) {
		this.subscribeId = subscribeId;
		this.errorCode = errorCode;
		this.reasonPhrase = reasonPhrase;
		this.trackAlias = trackAlias;
	}

	async encodeMessage(w: Writer): Promise<void> {
		await w.u62(this.subscribeId);
		await w.u62(BigInt(this.errorCode));
		await w.string(this.reasonPhrase);
		await w.u62(this.trackAlias);
	}

	static async decodeMessage(r: Reader): Promise<SubscribeError> {
		const subscribeId = await r.u62();
		const errorCode = Number(await r.u62());
		const reasonPhrase = await r.string();
		const trackAlias = await r.u62();

		return new SubscribeError(subscribeId, errorCode, reasonPhrase, trackAlias);
	}
}

export class Unsubscribe {
	static readonly id = 0x0a;

	subscribeId: bigint;

	constructor(subscribeId: bigint) {
		this.subscribeId = subscribeId;
	}

	async encodeMessage(w: Writer): Promise<void> {
		await w.u62(this.subscribeId);
	}

	static async decodeMessage(r: Reader): Promise<Unsubscribe> {
		const subscribeId = await r.u62();
		return new Unsubscribe(subscribeId);
	}
}

export class SubscribeDone {
	static readonly id = 0x0b;

	subscribeId: bigint;
	statusCode: number;
	reasonPhrase: string;
	final?: [bigint, bigint];

	constructor(subscribeId: bigint, statusCode: number, reasonPhrase: string, final?: [bigint, bigint]) {
		this.subscribeId = subscribeId;
		this.statusCode = statusCode;
		this.reasonPhrase = reasonPhrase;
		this.final = final;
	}

	async encodeMessage(w: Writer): Promise<void> {
		await w.u62(this.subscribeId);
		await w.u62(BigInt(this.statusCode));
		await w.string(this.reasonPhrase);
		if (this.final) {
			await w.u8(1);
			await w.u62(this.final[0]);
			await w.u62(this.final[1]);
		} else {
			await w.u8(0);
		}
	}

	static async decodeMessage(r: Reader): Promise<SubscribeDone> {
		const subscribeId = await r.u62();
		const statusCode = Number(await r.u62());
		const reasonPhrase = await r.string();
		const contentExists = await r.u53();
		let final: [bigint, bigint] | undefined;
		if (contentExists === 1) {
			final = [await r.u62(), await r.u62()];
		}

		return new SubscribeDone(subscribeId, statusCode, reasonPhrase, final);
	}
}
