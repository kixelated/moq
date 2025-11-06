import type { Reader, Writer } from "../stream";

export class GroupOrder {
	#value: number;

	private constructor(value: number) {
		this.#value = value;
	}

	static readonly Any = new GroupOrder(0x0);
	static readonly Ascending = new GroupOrder(0x1);
	static readonly Descending = new GroupOrder(0x2);

	async encode(w: Writer): Promise<void> {
		await w.u8(this.#value);
	}

	static async decode(r: Reader): Promise<GroupOrder> {
		const value = await r.u8();
		switch (value) {
			case 0x0:
				return GroupOrder.Any;
			case 0x1:
				return GroupOrder.Ascending;
			case 0x2:
				return GroupOrder.Descending;
			default:
				throw new Error(`Invalid GroupOrder: ${value}`);
		}
	}
}

export interface GroupFlags {
	hasExtensions: boolean;
	hasSubgroup: boolean;
	hasSubgroupObject: boolean;
	hasEnd: boolean;
}

/**
 * STREAM_HEADER_SUBGROUP from moq-transport spec.
 * Used for stream-per-group delivery mode.
 */
export class GroupHeader {
	flags: GroupFlags;
	trackAlias: bigint;
	groupId: number;
	subGroupId: number;
	publisherPriority: number;

	constructor(trackAlias: bigint, groupId: number, subGroupId: number, publisherPriority: number, flags: GroupFlags) {
		this.flags = flags;
		this.trackAlias = trackAlias;
		this.groupId = groupId;
		this.subGroupId = subGroupId;
		this.publisherPriority = publisherPriority;
	}

	async encode(w: Writer): Promise<void> {
		if (!this.flags.hasSubgroup && this.subGroupId !== 0) {
			throw new Error(`Subgroup ID must be 0 if hasSubgroup is false: ${this.subGroupId}`);
		}

		let id = 0x10;
		if (this.flags.hasExtensions) {
			id |= 0x01;
		}
		if (this.flags.hasSubgroupObject) {
			id |= 0x02;
		}
		if (this.flags.hasSubgroup) {
			id |= 0x04;
		}
		if (this.flags.hasEnd) {
			id |= 0x08;
		}
		await w.u53(id);
		await w.u62(this.trackAlias);
		await w.u53(this.groupId);
		if (this.flags.hasSubgroup) {
			await w.u53(this.subGroupId);
		}
		await w.u8(0); // publisher priority
	}

	static async decode(r: Reader): Promise<GroupHeader> {
		const id = await r.u53();
		if (id < 0x10 || id > 0x1f) {
			throw new Error(`Unsupported group type: ${id}`);
		}

		const flags = {
			hasExtensions: (id & 0x01) !== 0,
			hasSubgroupObject: (id & 0x02) !== 0,
			hasSubgroup: (id & 0x04) !== 0,
			hasEnd: (id & 0x08) !== 0,
		};

		const trackAlias = await r.u62();
		const groupId = await r.u53();
		const subGroupId = flags.hasSubgroup ? await r.u53() : 0;
		const publisherPriority = await r.u8(); // Don't care about publisher priority

		return new GroupHeader(trackAlias, groupId, subGroupId, publisherPriority, flags);
	}
}

const GROUP_END = 0x03;

export class GroupObject {
	id_delta: number;

	// undefined means end of group
	payload?: Uint8Array;

	constructor(id_delta: number, payload?: Uint8Array) {
		this.id_delta = id_delta;
		this.payload = payload;
	}

	async encode(w: Writer, flags: GroupFlags): Promise<void> {
		await w.u53(this.id_delta);

		if (flags.hasExtensions) {
			await w.u53(0); // extensions length = 0
		}

		if (this.payload !== undefined) {
			await w.u53(this.payload.byteLength);

			if (this.payload.byteLength === 0) {
				await w.u53(0); // status = normal
			} else {
				await w.write(this.payload);
			}
		} else {
			await w.u53(0); // length = 0
			await w.u53(GROUP_END);
		}
	}

	static async decode(r: Reader, flags: GroupFlags): Promise<GroupObject> {
		const delta = await r.u53();

		if (flags.hasExtensions) {
			const extensionsLength = await r.u53();
			// We don't care about extensions
			await r.read(extensionsLength);
		}

		const payloadLength = await r.u53();

		if (payloadLength > 0) {
			const payload = await r.read(payloadLength);
			return new GroupObject(delta, payload);
		}

		const status = await r.u53();

		if (status === 0) {
			return new GroupObject(delta, new Uint8Array(0));
		}

		if (!flags.hasEnd && status === 3) {
			return new GroupObject(delta);
		}

		throw new Error(`Unsupported object status: ${status}`);
	}
}
