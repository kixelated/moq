import * as Message from "./message";
import type { Valid } from "../path";
import type { Reader, Writer } from "./stream";

export class Announce {
	suffix: Valid;
	active: boolean;

	constructor(suffix: Valid, active: boolean) {
		this.suffix = suffix;
		this.active = active;
	}

	async encodeBody(w: Writer) {
		await w.u8(this.active ? 1 : 0);
		await w.path(this.suffix);
	}

	static async decodeBody(r: Reader): Promise<Announce> {
		const active = (await r.u8()) === 1;
		const suffix = await r.path();
		return new Announce(suffix, active);
	}

	// Wrapper methods that automatically handle size prefixing
	async encode(w: Writer): Promise<void> {
		return Message.encode(this, w);
	}

	static async decode(r: Reader): Promise<Announce> {
		return Message.decode(Announce, r);
	}

	static async decode_maybe(r: Reader): Promise<Announce | undefined> {
		if (await r.done()) return;
		return Announce.decode(r);
	}
}

export class AnnounceInterest {
	static StreamID = 0x1;
	prefix: Valid;

	constructor(prefix: Valid) {
		this.prefix = prefix;
	}

	async encodeBody(w: Writer) {
		await w.path(this.prefix);
	}

	static async decodeBody(r: Reader): Promise<AnnounceInterest> {
		const prefix = await r.path();
		return new AnnounceInterest(prefix);
	}

	// Wrapper methods that automatically handle size prefixing
	async encode(w: Writer): Promise<void> {
		return Message.encode(this, w);
	}

	static async decode(r: Reader): Promise<AnnounceInterest> {
		return Message.decode(AnnounceInterest, r);
	}
}

export class AnnounceInit {
	suffixes: Valid[];

	constructor(paths: Valid[]) {
		this.suffixes = paths;
	}

	async encodeBody(w: Writer) {
		await w.u53(this.suffixes.length);
		for (const path of this.suffixes) {
			await w.path(path);
		}
	}

	static async decodeBody(r: Reader): Promise<AnnounceInit> {
		const count = await r.u53();
		const suffixes: Valid[] = [];
		for (let i = 0; i < count; i++) {
			suffixes.push(await r.path());
		}
		return new AnnounceInit(suffixes);
	}

	// Wrapper methods that automatically handle size prefixing
	async encode(w: Writer): Promise<void> {
		return Message.encode(this, w);
	}

	static async decode(r: Reader): Promise<AnnounceInit> {
		return Message.decode(AnnounceInit, r);
	}
}
