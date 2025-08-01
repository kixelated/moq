import type { Reader, Writer } from "../stream";

export class Group {
	subscribe: bigint;
	sequence: number;

	static StreamID = 0x0;

	constructor(subscribe: bigint, sequence: number) {
		this.subscribe = subscribe;
		this.sequence = sequence;
	}

	async #encode(w: Writer) {
		await w.u62(this.subscribe);
		await w.u53(this.sequence);
	}

	static async #decode(r: Reader): Promise<Group> {
		return new Group(await r.u62(), await r.u53());
	}

	async encode(w: Writer): Promise<void> {
		return w.message(this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<Group> {
		return r.message(Group.#decode);
	}

	static async decodeMaybe(r: Reader): Promise<Group | undefined> {
		return r.messageMaybe(Group.#decode);
	}
}

export class GroupDrop {
	sequence: number;
	count: number;
	error: number;

	constructor(sequence: number, count: number, error: number) {
		this.sequence = sequence;
		this.count = count;
		this.error = error;
	}

	async #encode(w: Writer) {
		await w.u53(this.sequence);
		await w.u53(this.count);
		await w.u53(this.error);
	}

	static async #decode(r: Reader): Promise<GroupDrop> {
		return new GroupDrop(await r.u53(), await r.u53(), await r.u53());
	}

	async encode(w: Writer): Promise<void> {
		return w.message(this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<GroupDrop> {
		return r.message(GroupDrop.#decode);
	}

	static async decodeMaybe(r: Reader): Promise<GroupDrop | undefined> {
		return r.messageMaybe(GroupDrop.#decode);
	}
}

export class Frame {
	payload: Uint8Array;

	constructor(payload: Uint8Array) {
		this.payload = payload;
	}

	async #encode(w: Writer) {
		await w.write(this.payload);
	}

	static async #decode(r: Reader): Promise<Frame> {
		const payload = await r.readAll();
		return new Frame(payload);
	}

	async encode(w: Writer): Promise<void> {
		return w.message(this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<Frame> {
		return r.message(Frame.#decode);
	}
}
