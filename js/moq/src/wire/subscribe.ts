import { decodeMessage, encodeMessage } from "./message";
import type { Reader, Writer } from "./stream";

export class SubscribeUpdate {
	priority: number;

	constructor(priority: number) {
		this.priority = priority;
	}

	async encodeBody(w: Writer) {
		await w.u8(this.priority);
	}

	static async decodeBody(r: Reader): Promise<SubscribeUpdate> {
		const priority = await r.u8();
		return new SubscribeUpdate(priority);
	}

	// Wrapper methods that automatically handle size prefixing
	async encode(w: Writer): Promise<void> {
		return encodeMessage(this, w);
	}

	static async decode(r: Reader): Promise<SubscribeUpdate> {
		return decodeMessage(SubscribeUpdate, r);
	}

	static async decode_maybe(r: Reader): Promise<SubscribeUpdate | undefined> {
		if (await r.done()) return;
		return SubscribeUpdate.decode(r);
	}
}

export class Subscribe extends SubscribeUpdate {
	id: bigint;
	broadcast: string;
	track: string;

	static StreamID = 0x2;

	constructor(id: bigint, broadcast: string, track: string, priority: number) {
		super(priority);
		this.id = id;
		this.broadcast = broadcast;
		this.track = track;
	}

	override async encodeBody(w: Writer) {
		await w.u62(this.id);
		await w.string(this.broadcast);
		await w.string(this.track);
		await super.encodeBody(w);
	}

	static override async decodeBody(r: Reader): Promise<Subscribe> {
		const id = await r.u62();
		const broadcast = await r.string();
		const track = await r.string();
		const update = await SubscribeUpdate.decodeBody(r);
		return new Subscribe(id, broadcast, track, update.priority);
	}

	// Wrapper methods that automatically handle size prefixing
	override async encode(w: Writer): Promise<void> {
		return encodeMessage(this, w);
	}

	static override async decode(r: Reader): Promise<Subscribe> {
		return decodeMessage(Subscribe, r);
	}
}

export class SubscribeOk {
	priority: number;

	constructor(priority: number) {
		this.priority = priority;
	}

	async encodeBody(w: Writer) {
		await w.u53(this.priority);
	}

	static async decodeBody(r: Reader): Promise<SubscribeOk> {
		const priority = await r.u53();
		return new SubscribeOk(priority);
	}

	// Wrapper methods that automatically handle size prefixing
	async encode(w: Writer): Promise<void> {
		return encodeMessage(this, w);
	}

	static async decode(r: Reader): Promise<SubscribeOk> {
		return decodeMessage(SubscribeOk, r);
	}
}
