import type * as Path from "../path.ts";
import type { Reader, Writer } from "../stream.ts";
import * as Message from "./message.ts";
import * as Namespace from "./namespace.ts";
import { Parameters } from "./parameters.ts";

// In draft-14, ANNOUNCE is renamed to PUBLISH_NAMESPACE
export class PublishNamespace {
	static id = 0x06;

	requestId: number;
	trackNamespace: Path.Valid;

	constructor(requestId: number, trackNamespace: Path.Valid) {
		this.requestId = requestId;
		this.trackNamespace = trackNamespace;
	}

	async #encode(w: Writer): Promise<void> {
		await w.u53(this.requestId);
		await Namespace.encode(w, this.trackNamespace);
		await w.u8(0); // number of parameters
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<PublishNamespace> {
		return Message.decode(r, PublishNamespace.#decode);
	}

	static async #decode(r: Reader): Promise<PublishNamespace> {
		const requestId = await r.u53();
		const trackNamespace = await Namespace.decode(r);
		await Parameters.decode(r); // ignore parameters
		return new PublishNamespace(requestId, trackNamespace);
	}
}

export class PublishNamespaceOk {
	static id = 0x07;

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

	static async decode(r: Reader): Promise<PublishNamespaceOk> {
		return Message.decode(r, PublishNamespaceOk.#decode);
	}

	static async #decode(r: Reader): Promise<PublishNamespaceOk> {
		const requestId = await r.u53();
		return new PublishNamespaceOk(requestId);
	}
}

export class PublishNamespaceError {
	static id = 0x08;

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

	static async decode(r: Reader): Promise<PublishNamespaceError> {
		return Message.decode(r, PublishNamespaceError.#decode);
	}

	static async #decode(r: Reader): Promise<PublishNamespaceError> {
		const requestId = await r.u53();
		const errorCode = Number(await r.u62());
		const reasonPhrase = await r.string();
		return new PublishNamespaceError(requestId, errorCode, reasonPhrase);
	}
}

export class PublishNamespaceCancel {
	static id = 0x0c;

	trackNamespace: Path.Valid;
	errorCode: number;
	reasonPhrase: string;

	constructor(trackNamespace: Path.Valid, errorCode: number = 0, reasonPhrase: string = "") {
		this.trackNamespace = trackNamespace;
		this.errorCode = errorCode;
		this.reasonPhrase = reasonPhrase;
	}

	async #encode(w: Writer): Promise<void> {
		await Namespace.encode(w, this.trackNamespace);
		await w.u62(BigInt(this.errorCode));
		await w.string(this.reasonPhrase);
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<PublishNamespaceCancel> {
		return Message.decode(r, PublishNamespaceCancel.#decode);
	}

	static async #decode(r: Reader): Promise<PublishNamespaceCancel> {
		const trackNamespace = await Namespace.decode(r);
		const errorCode = Number(await r.u62());
		const reasonPhrase = await r.string();
		return new PublishNamespaceCancel(trackNamespace, errorCode, reasonPhrase);
	}
}

// In draft-14, UNANNOUNCE is renamed to PUBLISH_NAMESPACE_DONE
export class PublishNamespaceDone {
	static readonly id = 0x09;

	trackNamespace: Path.Valid;

	constructor(trackNamespace: Path.Valid) {
		this.trackNamespace = trackNamespace;
	}

	async #encode(w: Writer): Promise<void> {
		await Namespace.encode(w, this.trackNamespace);
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<PublishNamespaceDone> {
		return Message.decode(r, PublishNamespaceDone.#decode);
	}

	static async #decode(r: Reader): Promise<PublishNamespaceDone> {
		const trackNamespace = await Namespace.decode(r);
		return new PublishNamespaceDone(trackNamespace);
	}
}
