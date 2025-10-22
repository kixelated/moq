import type { Reader, Writer } from "../stream";

export class MaxRequestId {
	static id = 0x15;

	requestId: number;

	constructor(requestId: number) {
		this.requestId = requestId;
	}

	async encode(w: Writer): Promise<void> {
		await w.u53(this.requestId);
	}

	static async decode(r: Reader): Promise<MaxRequestId> {
		return new MaxRequestId(await r.u53());
	}
}

export class RequestsBlocked {
	static id = 0x1a;

	requestId: number;

	constructor(requestId: number) {
		this.requestId = requestId;
	}

	async encode(w: Writer): Promise<void> {
		await w.u53(this.requestId);
	}

	static async decode(r: Reader): Promise<RequestsBlocked> {
		return new RequestsBlocked(await r.u53());
	}
}
