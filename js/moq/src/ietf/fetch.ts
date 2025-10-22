import type * as Path from "../path.ts";
import type { Reader, Writer } from "../stream.ts";
import * as Message from "./message.ts";

export class Fetch {
	static id = 0x16;

	requestId: number;
	trackNamespace: Path.Valid;
	trackName: string;
	subscriberPriority: number;
	groupOrder: number;
	startGroup: bigint;
	startObject: bigint;
	endGroup: bigint;
	endObject: bigint;

	constructor(
		requestId: number,
		trackNamespace: Path.Valid,
		trackName: string,
		subscriberPriority: number,
		groupOrder: number,
		startGroup: bigint,
		startObject: bigint,
		endGroup: bigint,
		endObject: bigint,
	) {
		this.requestId = requestId;
		this.trackNamespace = trackNamespace;
		this.trackName = trackName;
		this.subscriberPriority = subscriberPriority;
		this.groupOrder = groupOrder;
		this.startGroup = startGroup;
		this.startObject = startObject;
		this.endGroup = endGroup;
		this.endObject = endObject;
	}

	async #encode(_w: Writer): Promise<void> {
		throw new Error("FETCH messages are not supported");
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<Fetch> {
		return Message.decode(r, Fetch.#decode);
	}

	static async #decode(_r: Reader): Promise<Fetch> {
		throw new Error("FETCH messages are not supported");
	}
}

export class FetchOk {
	static id = 0x18;

	requestId: number;

	constructor(requestId: number) {
		this.requestId = requestId;
	}

	async #encode(_w: Writer): Promise<void> {
		throw new Error("FETCH_OK messages are not supported");
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<FetchOk> {
		return Message.decode(r, FetchOk.#decode);
	}

	static async #decode(_r: Reader): Promise<FetchOk> {
		throw new Error("FETCH_OK messages are not supported");
	}
}

export class FetchError {
	static id = 0x19;

	requestId: number;
	errorCode: number;
	reasonPhrase: string;

	constructor(requestId: number, errorCode: number, reasonPhrase: string) {
		this.requestId = requestId;
		this.errorCode = errorCode;
		this.reasonPhrase = reasonPhrase;
	}

	async #encode(_w: Writer): Promise<void> {
		throw new Error("FETCH_ERROR messages are not supported");
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<FetchError> {
		return Message.decode(r, FetchError.#decode);
	}

	static async #decode(_r: Reader): Promise<FetchError> {
		throw new Error("FETCH_ERROR messages are not supported");
	}
}

export class FetchCancel {
	static id = 0x17;

	requestId: number;

	constructor(requestId: number) {
		this.requestId = requestId;
	}

	async #encode(_w: Writer): Promise<void> {
		throw new Error("FETCH_CANCEL messages are not supported");
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<FetchCancel> {
		return Message.decode(r, FetchCancel.#decode);
	}

	static async #decode(_r: Reader): Promise<FetchCancel> {
		throw new Error("FETCH_CANCEL messages are not supported");
	}
}
