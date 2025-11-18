import * as Path from "../path.ts";
import type { Reader, Writer } from "../stream.ts";
import * as Message from "./message.ts";
import { Version } from "./version.ts";

export class SubscribeUpdate {
	priority: number;

	constructor(priority: number) {
		this.priority = priority;
	}

	async #encode(w: Writer) {
		await w.u8(this.priority);
	}

	static async #decode(r: Reader): Promise<SubscribeUpdate> {
		const priority = await r.u8();
		return new SubscribeUpdate(priority);
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<SubscribeUpdate> {
		return Message.decode(r, SubscribeUpdate.#decode);
	}

	static async decodeMaybe(r: Reader): Promise<SubscribeUpdate | undefined> {
		return Message.decodeMaybe(r, SubscribeUpdate.#decode);
	}
}

export class Subscribe {
	id: bigint;
	broadcast: Path.Valid;
	track: string;
	priority: number;

	constructor(id: bigint, broadcast: Path.Valid, track: string, priority: number) {
		this.id = id;
		this.broadcast = broadcast;
		this.track = track;
		this.priority = priority;
	}

	async #encode(w: Writer) {
		await w.u62(this.id);
		await w.string(this.broadcast);
		await w.string(this.track);
		await w.u8(this.priority);
	}

	static async #decode(r: Reader): Promise<Subscribe> {
		const id = await r.u62();
		const broadcast = Path.from(await r.string());
		const track = await r.string();
		const priority = await r.u8();
		return new Subscribe(id, broadcast, track, priority);
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<Subscribe> {
		return Message.decode(r, Subscribe.#decode);
	}
}

export class SubscribeOk {
	// The version
	readonly version: Version;
	priority?: number;

	constructor({ version, priority = undefined }: { version: Version; priority?: number }) {
		this.version = version;
		this.priority = priority;
	}

	async #encode(w: Writer) {
		if (this.version === Version.DRAFT_02) {
			// noop
		} else if (this.version === Version.DRAFT_01) {
			await w.u8(this.priority ?? 0);
		} else {
			const version: never = this.version;
			throw new Error(`unsupported version: ${version}`);
		}
	}

	static async #decode(version: Version, r: Reader): Promise<SubscribeOk> {
		let priority: number | undefined;
		if (version === Version.DRAFT_02) {
			// noop
		} else if (version === Version.DRAFT_01) {
			priority = await r.u8();
		} else {
			const v: never = version;
			throw new Error(`unsupported version: ${v}`);
		}

		return new SubscribeOk({ version, priority });
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader, version: Version): Promise<SubscribeOk> {
		return Message.decode(r, SubscribeOk.#decode.bind(SubscribeOk, version));
	}
}
