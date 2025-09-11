import type * as Path from "../path.ts";
import type { Reader, Writer } from "../stream.ts";
import * as Namespace from "./namespace.ts";

export class SubscribeAnnounces {
	static id = 0x11;

	namespace: Path.Valid;

	constructor(namespace: Path.Valid) {
		this.namespace = namespace;
	}

	async encodeMessage(w: Writer): Promise<void> {
		await Namespace.encode(w, this.namespace);
		await w.u8(0); // no parameters
	}

	static async decodeMessage(r: Reader): Promise<SubscribeAnnounces> {
		const namespace = await Namespace.decode(r);

		const numParams = await r.u8();
		if (numParams !== 0) {
			throw new Error(`SUBSCRIBE_ANNOUNCES: parameters not supported: ${numParams}`);
		}

		return new SubscribeAnnounces(namespace);
	}
}

export class SubscribeAnnouncesOk {
	static id = 0x12;

	namespace: Path.Valid;

	constructor(namespace: Path.Valid) {
		this.namespace = namespace;
	}

	async encodeMessage(w: Writer): Promise<void> {
		await Namespace.encode(w, this.namespace);
	}

	static async decodeMessage(r: Reader): Promise<SubscribeAnnouncesOk> {
		const namespace = await Namespace.decode(r);
		return new SubscribeAnnouncesOk(namespace);
	}
}

export class SubscribeAnnouncesError {
	static id = 0x13;

	namespace: Path.Valid;
	errorCode: number;
	reasonPhrase: string;

	constructor(namespace: Path.Valid, errorCode: number, reasonPhrase: string) {
		this.namespace = namespace;
		this.errorCode = errorCode;
		this.reasonPhrase = reasonPhrase;
	}

	async encodeMessage(w: Writer): Promise<void> {
		await Namespace.encode(w, this.namespace);
		await w.u62(BigInt(this.errorCode));
		await w.string(this.reasonPhrase);
	}

	static async decodeMessage(r: Reader): Promise<SubscribeAnnouncesError> {
		const namespace = await Namespace.decode(r);
		const errorCode = Number(await r.u62());
		const reasonPhrase = await r.string();

		return new SubscribeAnnouncesError(namespace, errorCode, reasonPhrase);
	}
}

export class UnsubscribeAnnounces {
	static id = 0x14;

	namespace: Path.Valid;

	constructor(namespace: Path.Valid) {
		this.namespace = namespace;
	}

	async encodeMessage(w: Writer): Promise<void> {
		await Namespace.encode(w, this.namespace);
	}

	static async decodeMessage(r: Reader): Promise<UnsubscribeAnnounces> {
		const namespace = await Namespace.decode(r);
		return new UnsubscribeAnnounces(namespace);
	}
}
