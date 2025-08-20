import type { Reader, Writer } from "../stream";

const SUBGROUP_ID = 0x0; // Must always be layer 0
const STREAM_TYPE = 0x04;
const GROUP_END = 0x03;

/**
 * STREAM_HEADER_SUBGROUP from moq-transport spec.
 * Used for stream-per-group delivery mode.
 */
export class Group {
	static id = STREAM_TYPE;

	subscribeId: bigint;
	trackAlias: bigint;
	groupId: number;
	publisherPriority: number;

	constructor(subscribeId: bigint, trackAlias: bigint, groupId: number, publisherPriority: number) {
		this.subscribeId = subscribeId;
		this.trackAlias = trackAlias;
		this.groupId = groupId;
		this.publisherPriority = publisherPriority;
	}

	async encode(w: Writer): Promise<void> {
		// Stream type is written by the caller
		await w.u62(this.subscribeId);
		await w.u62(this.trackAlias);
		await w.u53(this.groupId);
		await w.u8(SUBGROUP_ID);
		await w.u8(this.publisherPriority);
	}

	static async decode(r: Reader): Promise<Group> {
		const subscribeId = await r.u62();
		const trackAlias = await r.u62();
		const groupId = await r.u53();
		const subgroupId = await r.u53();
		if (subgroupId !== SUBGROUP_ID) {
			throw new Error(`Unsupported subgroup id: ${subgroupId}`);
		}
		const publisherPriority = await r.u8();

		return new Group(subscribeId, trackAlias, groupId, publisherPriority);
	}
}

export class Frame {
	id: number;

	// undefined means end of group
	payload?: Uint8Array;

	constructor(id: number, payload?: Uint8Array) {
		this.id = id;
		this.payload = payload;
	}

	async encode(w: Writer): Promise<void> {
		await w.u53(this.id);

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

	static async decode(r: Reader): Promise<Frame> {
		const id = await r.u53();

		const payloadLength = await r.u53();

		if (payloadLength > 0) {
			const payload = await r.read(payloadLength);
			return new Frame(id, payload);
		}

		const status = await r.u53();

		// TODO status === 0 should be an empty frame, but moq-rs seems to be sending it incorrectly on group end.
		if (status === 0 || status === GROUP_END) {
			return new Frame(id);
		}

		throw new Error(`Unsupported object status: ${status}`);
	}
}

/**
 * Helper to read a stream type from a reader.
 */
export async function readStreamType(r: Reader): Promise<void> {
	const streamType = await r.u53();
	if (streamType !== STREAM_TYPE) {
		throw new Error(`Unsupported stream type: ${streamType}`);
	}
}

/**
 * Helper to write a stream type to a writer.
 */
export async function writeStreamType(w: Writer): Promise<void> {
	await w.u53(STREAM_TYPE);
}
