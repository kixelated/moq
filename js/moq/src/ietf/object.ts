import type { Reader, Writer } from "../stream.ts";

const SUBGROUP_ID = 0x0; // Must always be layer 0
const STREAM_TYPE = 0x04;
const GROUP_END = 0x03;

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
export class Group {
	static id = STREAM_TYPE;

	requestId: number;
	groupId: number;
	flags: GroupFlags;

	constructor(requestId: number, groupId: number, flags: GroupFlags) {
		if (flags.hasSubgroup && flags.hasSubgroupObject) {
			throw new Error("hasSubgroup and hasSubgroupObject cannot be true at the same time");
		}

		this.requestId = requestId;
		this.groupId = groupId;
		this.flags = flags;
	}

	async encode(w: Writer): Promise<void> {
		let id = 0x10;
		if (this.flags.hasExtensions) {
			id |= 0x01;
		}
		if (this.flags.hasSubgroup) {
			id |= 0x02;
		}
		if (this.flags.hasSubgroupObject) {
			id |= 0x04;
		}
		if (this.flags.hasEnd) {
			id |= 0x08;
		}
		await w.u53(id);
		await w.u53(this.requestId);
		await w.u53(this.groupId);
		if (this.flags.hasSubgroup) {
			await w.u8(SUBGROUP_ID);
		}
		await w.u8(0); // publisher priority
	}

	static async decode(r: Reader): Promise<Group> {
		const id = await r.u53();
		if (id < 0x10 || id > 0x1d) {
			throw new Error(`Unsupported group type: ${id}`);
		}

		const flags = {
			hasExtensions: (id & 0x01) !== 0,
			hasSubgroup: (id & 0x02) !== 0,
			hasSubgroupObject: (id & 0x04) !== 0,
			hasEnd: (id & 0x08) !== 0,
		};

		const requestId = await r.u53();
		const groupId = await r.u53();

		if (flags.hasSubgroup) {
			const subgroupId = await r.u53();
			if (subgroupId !== SUBGROUP_ID) {
				throw new Error(`Unsupported subgroup id: ${subgroupId}`);
			}
		}

		await r.u8(); // Don't care about publisher priority

		return new Group(requestId, groupId, flags);
	}
}

export class Frame {
	// undefined means end of group
	payload?: Uint8Array;

	constructor(payload?: Uint8Array) {
		this.payload = payload;
	}

	async encode(w: Writer, flags: GroupFlags): Promise<void> {
		await w.u8(0); // id_delta = 0

		if (flags.hasExtensions) {
			await w.u53(0); // extensions length = 0
		}

		if (this.payload !== undefined) {
			await w.u53(this.payload.byteLength);

			if (this.payload.byteLength === 0) {
				await w.u8(0); // status = normal
			} else {
				await w.write(this.payload);
			}
		} else {
			await w.u8(0); // length = 0
			await w.u8(GROUP_END);
		}
	}

	static async decode(r: Reader, flags: GroupFlags): Promise<Frame> {
		const delta = await r.u53();
		if (delta !== 0) {
			throw new Error(`Unsupported delta: ${delta}`);
		}

		if (flags.hasExtensions) {
			const extensionsLength = await r.u53();
			if (extensionsLength > 0) {
				throw new Error(`Unsupported extensions length: ${extensionsLength}`);
			}

			// Don't care about extensions
			await r.read(extensionsLength);
		}

		const payloadLength = await r.u53();

		if (payloadLength > 0) {
			const payload = await r.read(payloadLength);
			return new Frame(payload);
		}

		const status = await r.u53();

		if (flags.hasEnd) {
			// Empty frame
			if (status === 0) return new Frame(new Uint8Array(0));
		} else if (status === 0 || status === GROUP_END) {
			// TODO status === 0 should be an empty frame, but moq-rs seems to be sending it incorrectly on group end.
			return new Frame();
		}

		throw new Error(`Unsupported object status: ${status}`);
	}
}
