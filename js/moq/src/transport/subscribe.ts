import type { Valid } from "../path";
import type { Reader, Writer } from "../stream";
import * as Message from "./message";

export class Subscribe implements Message.Encode {
	static StreamID = 0x03;

	subscribeId: bigint;
	trackAlias: bigint;
	trackNamespace: Valid;
	trackName: Valid;
	subscriberPriority: number;
	groupOrder: number;
	filterType: number;
	// Additional filter-specific fields would go here

	constructor(
		subscribeId: bigint,
		trackAlias: bigint,
		trackNamespace: Valid,
		trackName: Valid,
		subscriberPriority: number,
		groupOrder: number,
		filterType: number,
	) {
		this.subscribeId = subscribeId;
		this.trackAlias = trackAlias;
		this.trackNamespace = trackNamespace;
		this.trackName = trackName;
		this.subscriberPriority = subscriberPriority;
		this.groupOrder = groupOrder;
		this.filterType = filterType;
	}

	async encode(w: Writer): Promise<void> {
		await Message.encode(w, this, this.encodeBody);
	}

	async encodeBody(w: Writer): Promise<void> {
		await w.u62(this.subscribeId);
		await w.u62(this.trackAlias);
		await w.path(this.trackNamespace);
		await w.path(this.trackName);
		await w.u8(this.subscriberPriority);
		await w.u8(this.groupOrder);
		await w.u62(BigInt(this.filterType));

		// TODO: Implement filter-specific fields based on filterType
	}

	static async decodeBody(r: Reader): Promise<Subscribe> {
		const subscribeId = await r.u62();
		const trackAlias = await r.u62();
		const trackNamespace = await r.path();
		const trackName = await r.path();
		const subscriberPriority = await r.u8();
		const groupOrder = await r.u8();
		const filterType = Number(await r.u62());

		// TODO: Decode filter-specific fields based on filterType

		return new Subscribe(
			subscribeId,
			trackAlias,
			trackNamespace,
			trackName,
			subscriberPriority,
			groupOrder,
			filterType,
		);
	}

	// Filter types from the spec
	static readonly FILTER_LATEST_GROUP = 0x01;
	static readonly FILTER_LATEST_OBJECT = 0x02;
	static readonly FILTER_ABSOLUTE_START = 0x03;
	static readonly FILTER_ABSOLUTE_RANGE = 0x04;
}

export class SubscribeOk implements Message.Encode {
	static StreamID = 0x04;

	subscribeId: bigint;
	expires: bigint; // Duration in milliseconds
	groupOrder: number;
	contentExists: boolean;

	constructor(subscribeId: bigint, expires: bigint, groupOrder: number, contentExists: boolean) {
		this.subscribeId = subscribeId;
		this.expires = expires;
		this.groupOrder = groupOrder;
		this.contentExists = contentExists;
	}

	async encode(w: Writer): Promise<void> {
		await Message.encode(w, this, this.encodeBody);
	}

	async encodeBody(w: Writer): Promise<void> {
		await w.u62(this.subscribeId);
		await w.u62(this.expires);
		await w.u8(this.groupOrder);
		await w.u8(this.contentExists ? 1 : 0);
	}

	static async decodeBody(r: Reader): Promise<SubscribeOk> {
		const subscribeId = await r.u62();
		const expires = await r.u62();
		const groupOrder = await r.u8();
		const contentExists = (await r.u8()) === 1;

		return new SubscribeOk(subscribeId, expires, groupOrder, contentExists);
	}
}

export class SubscribeError implements Message.Encode {
	static StreamID = 0x05;

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

	async encode(w: Writer): Promise<void> {
		await Message.encode(w, this, this.encodeBody);
	}

	async encodeBody(w: Writer): Promise<void> {
		await w.u62(this.subscribeId);
		await w.u62(BigInt(this.errorCode));
		await w.string(this.reasonPhrase);
		await w.u62(this.trackAlias);
	}

	static async decodeBody(r: Reader): Promise<SubscribeError> {
		const subscribeId = await r.u62();
		const errorCode = Number(await r.u62());
		const reasonPhrase = await r.string();
		const trackAlias = await r.u62();

		return new SubscribeError(subscribeId, errorCode, reasonPhrase, trackAlias);
	}
}
