import type * as Path from "../path";
import type { Reader, Writer } from "../stream";

export class Fetch {
	static id = 0x16;

	subscribeId: bigint;
	trackNamespace: Path.Valid;
	trackName: string;
	subscriberPriority: number;
	groupOrder: number;
	startGroup: bigint;
	startObject: bigint;
	endGroup: bigint;
	endObject: bigint;

	constructor(
		subscribeId: bigint,
		trackNamespace: Path.Valid,
		trackName: string,
		subscriberPriority: number,
		groupOrder: number,
		startGroup: bigint,
		startObject: bigint,
		endGroup: bigint,
		endObject: bigint,
	) {
		this.subscribeId = subscribeId;
		this.trackNamespace = trackNamespace;
		this.trackName = trackName;
		this.subscriberPriority = subscriberPriority;
		this.groupOrder = groupOrder;
		this.startGroup = startGroup;
		this.startObject = startObject;
		this.endGroup = endGroup;
		this.endObject = endObject;
	}

	async encodeMessage(_w: Writer): Promise<void> {
		throw new Error("FETCH messages are not supported");
	}

	static async decodeMessage(_r: Reader): Promise<Fetch> {
		throw new Error("FETCH messages are not supported");
	}
}

export class FetchOk {
	static id = 0x18;

	subscribeId: bigint;

	constructor(subscribeId: bigint) {
		this.subscribeId = subscribeId;
	}

	async encodeMessage(_w: Writer): Promise<void> {
		throw new Error("FETCH_OK messages are not supported");
	}

	static async decodeMessage(_r: Reader): Promise<FetchOk> {
		throw new Error("FETCH_OK messages are not supported");
	}
}

export class FetchError {
	static id = 0x19;

	subscribeId: bigint;
	errorCode: number;
	reasonPhrase: string;

	constructor(subscribeId: bigint, errorCode: number, reasonPhrase: string) {
		this.subscribeId = subscribeId;
		this.errorCode = errorCode;
		this.reasonPhrase = reasonPhrase;
	}

	async encodeMessage(_w: Writer): Promise<void> {
		throw new Error("FETCH_ERROR messages are not supported");
	}

	static async decodeMessage(_r: Reader): Promise<FetchError> {
		throw new Error("FETCH_ERROR messages are not supported");
	}
}

export class FetchCancel {
	static id = 0x17;

	subscribeId: bigint;

	constructor(subscribeId: bigint) {
		this.subscribeId = subscribeId;
	}

	async encodeMessage(_w: Writer): Promise<void> {
		throw new Error("FETCH_CANCEL messages are not supported");
	}

	static async decodeMessage(_r: Reader): Promise<FetchCancel> {
		throw new Error("FETCH_CANCEL messages are not supported");
	}
}
