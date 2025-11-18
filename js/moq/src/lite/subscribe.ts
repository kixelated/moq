import * as Path from "../path.ts";
import type { Reader, Writer } from "../stream.ts";
import * as Message from "./message.ts";
import { Version } from "./version.ts";

export class SubscribeUpdate {
	priority: number;
	expires: DOMHighResTimeStamp;

	constructor({ priority = 0, expires = 0 }: { priority: number; expires: DOMHighResTimeStamp }) {
		this.priority = priority;
		this.expires = expires;
	}

	async #encode(w: Writer) {
		await w.u8(this.priority);
		await w.u53(this.expires);
	}

	static async #decode(r: Reader): Promise<SubscribeUpdate> {
		const priority = await r.u8();
		const expires = await r.u53();
		return new SubscribeUpdate({ priority, expires });
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
	expires: DOMHighResTimeStamp;
	version: Version;

	constructor({
		id,
		broadcast,
		track,
		priority = 0,
		expires = 0,
		version,
	}: {
		id: bigint;
		broadcast: Path.Valid;
		track: string;
		priority: number;
		expires: DOMHighResTimeStamp;
		version: Version;
	}) {
		this.id = id;
		this.broadcast = broadcast;
		this.track = track;
		this.priority = priority;
		this.expires = expires;
		this.version = version;
	}

	async #encode(w: Writer) {
		await w.u62(this.id);
		await w.string(this.broadcast);
		await w.string(this.track);
		await w.u8(this.priority);

		if (this.version === Version.DRAFT_03) {
			await w.u53(this.expires);
		} else if (this.version === Version.DRAFT_02 || this.version === Version.DRAFT_01) {
			// noop
		} else {
			const version: never = this.version;
			throw new Error(`unsupported version: ${version}`);
		}
	}

	static async #decode(version: Version, r: Reader): Promise<Subscribe> {
		const id = await r.u62();
		const broadcast = Path.from(await r.string());
		const track = await r.string();
		const priority = await r.u8();

		let expires = 0;
		if (version === Version.DRAFT_03) {
			expires = await r.u53();
		} else if (version === Version.DRAFT_02 || version === Version.DRAFT_01) {
			// noop
		} else {
			const v: never = version;
			throw new Error(`unsupported version: ${v}`);
		}

		return new Subscribe({ id, broadcast, track, priority, expires, version });
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader, version: Version): Promise<Subscribe> {
		return Message.decode(r, Subscribe.#decode.bind(Subscribe, version));
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
		if (this.version === Version.DRAFT_03) {
			// noop
		} else if (this.version === Version.DRAFT_02 || this.version === Version.DRAFT_01) {
			// Technically, draft-02 is supposed to be empty but wasn't implemented like that.
			await w.u8(this.priority ?? 0);
		} else {
			const version: never = this.version;
			throw new Error(`unsupported version: ${version}`);
		}
	}

	static async #decode(version: Version, r: Reader): Promise<SubscribeOk> {
		let priority: number | undefined;
		if (version === Version.DRAFT_03) {
			// noop
		} else if (version === Version.DRAFT_02 || version === Version.DRAFT_01) {
			// Technically, draft-02 is supposed to be empty but wasn't implemented like that.
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
