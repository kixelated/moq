import type { Reader, Writer } from "../stream";

// Object delivery modes from moq-transport spec
export const DeliveryMode = {
	Track: 0x00,
	Subgroup: 0x01,
	Datagram: 0x02,
} as const;

export type DeliveryMode = (typeof DeliveryMode)[keyof typeof DeliveryMode];

// Stream types for object delivery
export const StreamType = {
	ObjectDatagram: 0x01,
	StreamHeaderSubgroup: 0x04,
	FetchHeader: 0x05,
} as const;

export type StreamType = (typeof StreamType)[keyof typeof StreamType];

// Object status values from moq-transport spec
export const ObjectStatus = {
	Normal: 0x00,
	ObjectNotExist: 0x01,
	GroupNotExist: 0x02,
	EndOfGroup: 0x03,
	EndOfTrack: 0x04,
} as const;

export type ObjectStatus = (typeof ObjectStatus)[keyof typeof ObjectStatus];

/**
 * STREAM_HEADER_SUBGROUP from moq-transport spec.
 * Used for stream-per-group delivery mode.
 */
export class StreamHeaderSubgroup {
	static id = StreamType.StreamHeaderSubgroup;

	subscribeId: bigint;
	trackAlias: bigint;
	groupId: bigint;
	objectSendOrder: bigint;

	constructor(subscribeId: bigint, trackAlias: bigint, groupId: bigint, objectSendOrder: bigint) {
		this.subscribeId = subscribeId;
		this.trackAlias = trackAlias;
		this.groupId = groupId;
		this.objectSendOrder = objectSendOrder;
	}

	async encode(w: Writer): Promise<void> {
		// Stream type is written by the caller
		await w.u62(this.subscribeId);
		await w.u62(this.trackAlias);
		await w.u62(this.groupId);
		await w.u62(this.objectSendOrder);
	}

	static async decode(r: Reader): Promise<StreamHeaderSubgroup> {
		const subscribeId = await r.u62();
		const trackAlias = await r.u62();
		const groupId = await r.u62();
		const objectSendOrder = await r.u62();

		return new StreamHeaderSubgroup(subscribeId, trackAlias, groupId, objectSendOrder);
	}
}

/**
 * Object within a stream (for stream-per-group delivery).
 * This follows the StreamHeaderSubgroup on the same stream.
 */
export class ObjectStream {
	objectId: bigint;
	objectStatus: ObjectStatus;
	objectPayload: Uint8Array;

	constructor(objectId: bigint, objectStatus: ObjectStatus, objectPayload: Uint8Array) {
		this.objectId = objectId;
		this.objectStatus = objectStatus;
		this.objectPayload = objectPayload;
	}

	async encode(w: Writer): Promise<void> {
		await w.u62(this.objectId);
		await w.u62(BigInt(this.objectStatus));
		await w.u53(this.objectPayload.byteLength);
		await w.write(this.objectPayload);
	}

	static async decode(r: Reader): Promise<ObjectStream> {
		const objectId = await r.u62();
		const objectStatus = Number(await r.u62()) as ObjectStatus;
		const payloadLength = await r.u53();
		const objectPayload = await r.read(payloadLength);

		// Verify we read the expected amount of data
		if (objectPayload.byteLength !== payloadLength) {
			throw new Error(`Object payload length mismatch: expected ${payloadLength}, got ${objectPayload.byteLength}`);
		}

		return new ObjectStream(objectId, objectStatus, objectPayload);
	}
}

/**
 * OBJECT_DATAGRAM from moq-transport spec.
 * Used for datagram delivery mode (not supported in lite compatibility).
 */
export class ObjectDatagram {
	static id = StreamType.ObjectDatagram;

	subscribeId: bigint;
	trackAlias: bigint;
	groupId: bigint;
	objectId: bigint;
	objectSendOrder: number;
	objectStatus: ObjectStatus;
	objectPayload: Uint8Array;

	constructor(
		subscribeId: bigint,
		trackAlias: bigint,
		groupId: bigint,
		objectId: bigint,
		objectSendOrder: number,
		objectStatus: ObjectStatus,
		objectPayload: Uint8Array,
	) {
		this.subscribeId = subscribeId;
		this.trackAlias = trackAlias;
		this.groupId = groupId;
		this.objectId = objectId;
		this.objectSendOrder = objectSendOrder;
		this.objectStatus = objectStatus;
		this.objectPayload = objectPayload;
	}

	async encode(w: Writer): Promise<void> {
		// Datagram type is written by the caller
		await w.u62(this.subscribeId);
		await w.u62(this.trackAlias);
		await w.u62(this.groupId);
		await w.u62(this.objectId);
		await w.u62(BigInt(this.objectSendOrder));
		await w.u62(BigInt(this.objectStatus));
		await w.write(this.objectPayload);
	}

	static async decode(r: Reader): Promise<ObjectDatagram> {
		const subscribeId = await r.u62();
		const trackAlias = await r.u62();
		const groupId = await r.u62();
		const objectId = await r.u62();
		const objectSendOrder = Number(await r.u62());

		const objectStatus = Number(await r.u62()) as ObjectStatus;
		const objectPayload = await r.readAll();

		return new ObjectDatagram(
			subscribeId,
			trackAlias,
			groupId,
			objectId,
			objectSendOrder,
			objectStatus,
			objectPayload,
		);
	}
}

/**
 * Helper to read a stream type from a reader.
 */
export async function readStreamType(r: Reader): Promise<StreamType> {
	const streamType = await r.u53();
	if (!Object.values(StreamType).includes(streamType as StreamType)) {
		throw new Error(`Unknown stream type: ${streamType}`);
	}
	return streamType as StreamType;
}

/**
 * Helper to write a stream type to a writer.
 */
export async function writeStreamType(w: Writer, streamType: StreamType): Promise<void> {
	await w.u53(streamType);
}

/**
 * Throws an error for unsupported delivery modes.
 * Only stream-per-group (Subgroup) delivery is supported.
 */
export function assertSupportedDeliveryMode(mode: DeliveryMode): void {
	if (mode !== DeliveryMode.Subgroup) {
		const modeName = mode === DeliveryMode.Track ? "Track" : mode === DeliveryMode.Datagram ? "Datagram" : String(mode);
		throw new Error(
			`Delivery mode ${modeName} not supported. Only stream-per-group (Subgroup) delivery is supported.`,
		);
	}
}
