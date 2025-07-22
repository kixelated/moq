import type { Valid } from "../path";
import type { Reader, Writer } from "./stream";

export class Announce {
	suffix: Valid;
	active: boolean;

	constructor(suffix: Valid, active: boolean) {
		this.suffix = suffix;
		this.active = active;
	}

	async encode(w: Writer) {
		await w.u8(this.active ? 1 : 0);
		await w.path(this.suffix);
	}

	static async decode(r: Reader): Promise<Announce> {
		const active = (await r.u8()) === 1;
		const suffix = await r.path();
		return new Announce(suffix, active);
	}

	static async decode_maybe(r: Reader): Promise<Announce | undefined> {
		if (await r.done()) return;
		return await Announce.decode(r);
	}
}

export class AnnounceInterest {
	static StreamID = 0x1;
	prefix: Valid;

	constructor(prefix: Valid) {
		this.prefix = prefix;
	}

	async encode(w: Writer) {
		await w.path(this.prefix);
	}

	static async decode(r: Reader): Promise<AnnounceInterest> {
		const prefix = await r.path();
		return new AnnounceInterest(prefix);
	}
}

export class AnnounceInit {
	suffixes: Valid[];

	constructor(paths: Valid[]) {
		this.suffixes = paths;
	}

	async encode(w: Writer) {
		await w.u53(this.suffixes.length);
		for (const path of this.suffixes) {
			await w.path(path);
		}
	}

	static async decode(r: Reader): Promise<AnnounceInit> {
		const count = await r.u53();
		const paths: Valid[] = [];
		for (let i = 0; i < count; i++) {
			paths.push(await r.path());
		}
		return new AnnounceInit(paths);
	}
}
