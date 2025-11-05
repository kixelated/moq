import type { Reader, Writer } from "../stream";

export const GroupOrder = {
	Any: 0x0,
	Ascending: 0x1,
	Descending: 0x2,
} as const;

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
