import { decodeMessage, encodeMessage } from "./message";
import type { Reader, Writer } from "./stream";

export class Announce {
	suffix: string;
	active: boolean;

	constructor(suffix: string, active: boolean) {
		this.suffix = suffix;
		this.active = active;
	}

	async encodeBody(w: Writer) {
		await w.u53(this.active ? 1 : 0);
		await w.string(this.suffix);
	}

	static async decodeBody(r: Reader): Promise<Announce> {
		const active = (await r.u53()) === 1;
		const suffix = await r.string();
		return new Announce(suffix, active);
	}

	// Wrapper methods that automatically handle size prefixing
	async encode(w: Writer): Promise<void> {
		return encodeMessage(this, w);
	}

	static async decode(r: Reader): Promise<Announce> {
		return decodeMessage(Announce, r);
	}

	static async decode_maybe(r: Reader): Promise<Announce | undefined> {
		if (await r.done()) return;
		return Announce.decode(r);
	}
}

export class AnnounceInterest {
	static StreamID = 0x1;
	prefix: string;

	constructor(prefix: string) {
		this.prefix = prefix;
	}

	async encodeBody(w: Writer) {
		await w.string(this.prefix);
	}

	static async decodeBody(r: Reader): Promise<AnnounceInterest> {
		const prefix = await r.string();
		return new AnnounceInterest(prefix);
	}

	// Wrapper methods that automatically handle size prefixing
	async encode(w: Writer): Promise<void> {
		return encodeMessage(this, w);
	}

	static async decode(r: Reader): Promise<AnnounceInterest> {
		return decodeMessage(AnnounceInterest, r);
	}
}

export class AnnounceInit {
	paths: string[];

	constructor(paths: string[]) {
		this.paths = paths;
	}

	async encodeBody(w: Writer) {
		await w.u53(this.paths.length);
		for (const path of this.paths) {
			await w.string(path);
		}
	}

	static async decodeBody(r: Reader): Promise<AnnounceInit> {
		const count = await r.u53();
		const paths: string[] = [];
		for (let i = 0; i < count; i++) {
			paths.push(await r.string());
		}
		return new AnnounceInit(paths);
	}

	// Wrapper methods that automatically handle size prefixing
	async encode(w: Writer): Promise<void> {
		return encodeMessage(this, w);
	}

	static async decode(r: Reader): Promise<AnnounceInit> {
		return decodeMessage(AnnounceInit, r);
	}
}
