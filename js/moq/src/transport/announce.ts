import type * as Path from "../path";
import type { Reader, Writer } from "../stream";
import * as Namespace from "./namespace";

export class Announce {
	static id = 0x06;

	trackNamespace: Path.Valid;

	constructor(trackNamespace: Path.Valid) {
		this.trackNamespace = trackNamespace;
	}

	async encodeMessage(w: Writer): Promise<void> {
		await Namespace.encode(w, this.trackNamespace);
	}

	static async decodeMessage(r: Reader): Promise<Announce> {
		const trackNamespace = await Namespace.decode(r);
		return new Announce(trackNamespace);
	}
}

export class AnnounceOk {
	static id = 0x07;

	trackNamespace: Path.Valid;

	constructor(trackNamespace: Path.Valid) {
		this.trackNamespace = trackNamespace;
	}

	async encodeMessage(w: Writer): Promise<void> {
		await Namespace.encode(w, this.trackNamespace);
	}

	static async decodeMessage(r: Reader): Promise<AnnounceOk> {
		const trackNamespace = await Namespace.decode(r);
		return new AnnounceOk(trackNamespace);
	}
}

export class AnnounceError {
	static id = 0x08;

	trackNamespace: Path.Valid;
	errorCode: number;
	reasonPhrase: string;

	constructor(trackNamespace: Path.Valid, errorCode: number, reasonPhrase: string) {
		this.trackNamespace = trackNamespace;
		this.errorCode = errorCode;
		this.reasonPhrase = reasonPhrase;
	}

	async encodeMessage(w: Writer): Promise<void> {
		await Namespace.encode(w, this.trackNamespace);
		await w.u62(BigInt(this.errorCode));
		await w.string(this.reasonPhrase);
	}

	static async decodeMessage(r: Reader): Promise<AnnounceError> {
		const trackNamespace = await Namespace.decode(r);
		const errorCode = Number(await r.u62());
		const reasonPhrase = await r.string();
		return new AnnounceError(trackNamespace, errorCode, reasonPhrase);
	}
}

export class AnnounceCancel {
	static id = 0x0c;

	trackNamespace: Path.Valid;

	constructor(trackNamespace: Path.Valid) {
		this.trackNamespace = trackNamespace;
	}

	async encodeMessage(w: Writer): Promise<void> {
		await Namespace.encode(w, this.trackNamespace);
	}

	static async decodeMessage(r: Reader): Promise<AnnounceCancel> {
		const trackNamespace = await Namespace.decode(r);
		return new AnnounceCancel(trackNamespace);
	}
}

export class Unannounce {
	static readonly id = 0x09;

	trackNamespace: string[];

	constructor(trackNamespace: string[]) {
		this.trackNamespace = trackNamespace;
	}

	async encodeMessage(w: Writer): Promise<void> {
		await w.u53(this.trackNamespace.length);
		for (const part of this.trackNamespace) {
			await w.string(part);
		}
	}

	static async decodeMessage(r: Reader): Promise<Unannounce> {
		const trackNamespaceLength = await r.u53();
		const trackNamespace: string[] = [];
		for (let i = 0; i < trackNamespaceLength; i++) {
			trackNamespace.push(await r.string());
		}
		return new Unannounce(trackNamespace);
	}
}
