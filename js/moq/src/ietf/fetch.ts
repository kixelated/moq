import type * as Path from "../path.ts";
import type { Reader, Writer } from "../stream.ts";
import { GroupOrder } from "./group.ts";
import { Location } from "./location.js";
import * as Message from "./message.ts";
import * as Namespace from "./namespace.ts";
import { Parameters } from "./parameters.ts";

const FETCH_END = 0x03;

export const FetchType = {
	Standalone: 0x1,
	Relative: 0x2,
	Absolute: 0x3,
} as const;

export type FetchType =
	| {
			type: typeof FetchType.Standalone;
			namespace: Path.Valid;
			track: string;
			start: Location;
			end: Location;
	  }
	| {
			type: typeof FetchType.Relative;
			subscribeId: bigint;
			groupOffset: number;
	  }
	| {
			type: typeof FetchType.Absolute;
			subscribeId: bigint;
			groupId: number;
	  };

export class Fetch {
	static id = 0x16;

	requestId: bigint;
	subscriberPriority: number;
	groupOrder: GroupOrder;
	fetchType: FetchType;

	constructor(requestId: bigint, subscriberPriority: number, groupOrder: GroupOrder, fetchType: FetchType) {
		this.requestId = requestId;
		this.subscriberPriority = subscriberPriority;
		this.groupOrder = groupOrder;
		this.fetchType = fetchType;
	}

	async #encode(w: Writer): Promise<void> {
		await w.u62(this.requestId);
		await w.u8(this.subscriberPriority);
		await this.groupOrder.encode(w);
		await w.u53(this.fetchType.type);
		if (this.fetchType.type === FetchType.Standalone) {
			await Namespace.encode(w, this.fetchType.namespace);
			await w.string(this.fetchType.track);
			this.fetchType.start.encode(w);
			this.fetchType.end.encode(w);
		} else if (this.fetchType.type === FetchType.Relative) {
			await w.u62(this.fetchType.subscribeId);
			await w.u53(this.fetchType.groupOffset);
		} else if (this.fetchType.type === FetchType.Absolute) {
			await w.u62(this.fetchType.subscribeId);
			await w.u53(this.fetchType.groupId);
		} else {
			const fetchType: never = this.fetchType;
			throw new Error(`unknown fetch type: ${fetchType}`);
		}
		await w.u53(0); // no parameters
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<Fetch> {
		return Message.decode(r, Fetch.#decode);
	}

	static async #decode(r: Reader): Promise<Fetch> {
		const requestId = await r.u62();
		const subscriberPriority = await r.u8();
		const groupOrder = await GroupOrder.decode(r);
		const fetchType = await r.u53();

		if (fetchType === FetchType.Standalone) {
			const namespace = await Namespace.decode(r);
			const track = await r.string();
			const start = await Location.decode(r);
			const end = await Location.decode(r);
			await Parameters.decode(r); // ignore parameters
			return new Fetch(requestId, subscriberPriority, groupOrder, {
				type: FetchType.Standalone,
				namespace,
				track,
				start,
				end,
			});
		}

		if (fetchType === FetchType.Relative) {
			const subscribeId = await r.u62();
			const groupOffset = await r.u53();
			await Parameters.decode(r); // ignore parameters
			return new Fetch(requestId, subscriberPriority, groupOrder, {
				type: FetchType.Relative,
				subscribeId,
				groupOffset,
			});
		}

		if (fetchType === FetchType.Absolute) {
			const subscribeId = await r.u62();
			const groupId = await r.u53();
			await Parameters.decode(r); // ignore parameters
			return new Fetch(requestId, subscriberPriority, groupOrder, {
				type: FetchType.Absolute,
				subscribeId,
				groupId,
			});
		}

		throw new Error(`unknown fetch type: ${fetchType}`);
	}
}

export class FetchOk {
	static id = 0x18;

	requestId: bigint;
	groupOrder: GroupOrder;
	endOfTrack: boolean;
	endLocation: Location;

	constructor(requestId: bigint, groupOrder: GroupOrder, endOfTrack: boolean, endLocation: Location) {
		this.requestId = requestId;
		this.groupOrder = groupOrder;
		this.endOfTrack = endOfTrack;
		this.endLocation = endLocation;
	}

	async #encode(w: Writer): Promise<void> {
		await w.u62(this.requestId);
		await this.groupOrder.encode(w);
		await w.bool(this.endOfTrack);
		this.endLocation.encode(w);
		await w.u53(0); // no parameters
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<FetchOk> {
		return Message.decode(r, FetchOk.#decode);
	}

	static async #decode(r: Reader): Promise<FetchOk> {
		const requestId = await r.u62();
		const groupOrder = await GroupOrder.decode(r);
		const endOfTrack = await r.bool();
		const endLocation = await Location.decode(r);
		await Parameters.decode(r); // ignore parameters
		return new FetchOk(requestId, groupOrder, endOfTrack, endLocation);
	}
}

export class FetchError {
	static id = 0x19;

	requestId: bigint;
	errorCode: number;
	reasonPhrase: string;

	constructor(requestId: bigint, errorCode: number, reasonPhrase: string) {
		this.requestId = requestId;
		this.errorCode = errorCode;
		this.reasonPhrase = reasonPhrase;
	}

	async #encode(w: Writer): Promise<void> {
		await w.u62(this.requestId);
		await w.u53(this.errorCode);
		await w.string(this.reasonPhrase);
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<FetchError> {
		return Message.decode(r, FetchError.#decode);
	}

	static async #decode(r: Reader): Promise<FetchError> {
		const requestId = await r.u62();
		const errorCode = await r.u53();
		const reasonPhrase = await r.string();
		return new FetchError(requestId, errorCode, reasonPhrase);
	}
}

export class FetchCancel {
	static id = 0x17;

	requestId: bigint;

	constructor(requestId: bigint) {
		this.requestId = requestId;
	}

	async #encode(w: Writer): Promise<void> {
		await w.u62(this.requestId);
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<FetchCancel> {
		return Message.decode(r, FetchCancel.#decode);
	}

	static async #decode(r: Reader): Promise<FetchCancel> {
		const requestId = await r.u62();
		return new FetchCancel(requestId);
	}
}

export class FetchHeader {
	static id = 0x5;

	requestId: bigint;

	constructor(requestId: bigint) {
		this.requestId = requestId;
	}

	async encode(w: Writer): Promise<void> {
		await w.u62(this.requestId);
	}

	static async decode(r: Reader): Promise<FetchHeader> {
		const requestId = await r.u62();
		return new FetchHeader(requestId);
	}
}

export class FetchObject {
	groupId: number;
	subgroupId: number;
	objectId: number;
	publisherPriority: number;
	payload?: Uint8Array;

	constructor(
		groupId: number,
		subgroupId: number,
		objectId: number,
		publisherPriority: number,
		payload?: Uint8Array,
	) {
		this.groupId = groupId;
		this.subgroupId = subgroupId;
		this.objectId = objectId;
		this.publisherPriority = publisherPriority;
		this.payload = payload;
	}

	async encode(w: Writer): Promise<void> {
		await w.u53(this.groupId);
		await w.u53(this.subgroupId);
		await w.u53(this.objectId);
		await w.u8(this.publisherPriority);
		await w.u53(0); // no extension headers

		if (this.payload !== undefined) {
			await w.u53(this.payload.byteLength);
			if (this.payload.byteLength === 0) {
				await w.u53(0); // status = normal
			} else {
				await w.write(this.payload);
			}
		} else {
			await w.u53(0); // no payload, length = 0
			await w.u53(FETCH_END); // no payload, status = end
		}
	}

	static async decode(r: Reader): Promise<FetchObject> {
		const groupId = await r.u53();
		const subgroupId = await r.u53();
		const objectId = await r.u53();
		const publisherPriority = await r.u8();
		const payloadLength = await r.u53();

		let payload: Uint8Array | undefined;
		if (payloadLength === 0) {
			const status = await r.u53();
			if (status === 0) {
				payload = new Uint8Array(0);
			} else if (status === FETCH_END) {
				payload = undefined;
			} else {
				throw new Error(`unexpected status: ${status}`);
			}
		} else {
			payload = await r.read(payloadLength);
		}

		return new FetchObject(groupId, subgroupId, objectId, publisherPriority, payload);
	}
}
