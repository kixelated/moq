import * as Path from "../path";
import type { Reader, Writer } from "../stream";

export class Announce {
	suffix: Path.Valid;
	active: boolean;

	constructor(suffix: Path.Valid, active: boolean) {
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
	prefix: Path.Valid;

	constructor(prefix: Path.Valid) {
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
	suffixes: Path.Valid[];

	constructor(paths: Path.Valid[]) {
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
		const suffixes: Path.Valid[] = [];
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
