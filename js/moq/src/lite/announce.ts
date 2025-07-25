import { Path } from "..";
import type { Valid } from "../path";
import type { Reader, Writer } from "../stream";

export class Announce {
	suffix: Valid;
	active: boolean;

	constructor(suffix: Valid, active: boolean) {
		this.suffix = suffix;
		this.active = active;
	}

	async #encode(w: Writer) {
		await w.u8(this.active ? 1 : 0);
		await w.string(this.suffix);
	}

	static async #decode(r: Reader): Promise<Announce> {
		const active = (await r.u8()) === 1;
		const suffix = Path.from(await r.string());
		return new Announce(suffix, active);
	}

	async encode(w: Writer): Promise<void> {
		return w.message(this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<Announce> {
		return r.message(Announce.#decode);
	}

	static async decodeMaybe(r: Reader): Promise<Announce | undefined> {
		return r.messageMaybe(Announce.#decode);
	}
}

export class AnnounceInterest {
	static StreamID = 0x1;
	prefix: Valid;

	constructor(prefix: Valid) {
		this.prefix = prefix;
	}

	async #encode(w: Writer) {
		await w.string(this.prefix);
	}

	static async #decode(r: Reader): Promise<AnnounceInterest> {
		const prefix = Path.from(await r.string());
		return new AnnounceInterest(prefix);
	}

	async encode(w: Writer): Promise<void> {
		return w.message(this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<AnnounceInterest> {
		return r.message(AnnounceInterest.#decode);
	}
}

export class AnnounceInit {
	suffixes: Valid[];

	constructor(paths: Valid[]) {
		this.suffixes = paths;
	}

	async #encode(w: Writer) {
		await w.u53(this.suffixes.length);
		for (const path of this.suffixes) {
			await w.string(path);
		}
	}

	static async #decode(r: Reader): Promise<AnnounceInit> {
		const count = await r.u53();
		const suffixes: Valid[] = [];
		for (let i = 0; i < count; i++) {
			suffixes.push(Path.from(await r.string()));
		}
		return new AnnounceInit(suffixes);
	}

	async encode(w: Writer): Promise<void> {
		return w.message(this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<AnnounceInit> {
		return r.message(AnnounceInit.#decode);
	}
}
