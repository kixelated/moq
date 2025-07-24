import type { Reader, Writer } from "../stream";
import * as Message from "./message";

// Object delivery modes from moq-transport spec
export const DeliveryMode = {
	Track: 0x00,
	Subgroup: 0x01,
	Datagram: 0x02,
} as const;

export type DeliveryMode = (typeof DeliveryMode)[keyof typeof DeliveryMode];

export class ObjectStream implements Message.Encode {
	static StreamID = 0x02; // OBJECT_STREAM from spec

	subscribeId: bigint;
	trackAlias: bigint;
	groupId: bigint;
	objectId: bigint;
	objectSendOrder: number;
	objectStatus: number;

	constructor(
		subscribeId: bigint,
		trackAlias: bigint,
		groupId: bigint,
		objectId: bigint,
		objectSendOrder: number,
		objectStatus: number,
	) {
		this.subscribeId = subscribeId;
		this.trackAlias = trackAlias;
		this.groupId = groupId;
		this.objectId = objectId;
		this.objectSendOrder = objectSendOrder;
		this.objectStatus = objectStatus;
	}

	async encode(w: Writer): Promise<void> {
		await Message.encode(w, this, this.encodeBody);
	}

	async encodeBody(w: Writer): Promise<void> {
		await w.u62(this.subscribeId);
		await w.u62(this.trackAlias);
		await w.u62(this.groupId);
		await w.u62(this.objectId);
		await w.u62(BigInt(this.objectSendOrder));
		await w.u62(BigInt(this.objectStatus));
	}

	static async decodeBody(r: Reader): Promise<ObjectStream> {
		const subscribeId = await r.u62();
		const trackAlias = await r.u62();
		const groupId = await r.u62();
		const objectId = await r.u62();
		const objectSendOrder = Number(await r.u62());
		const objectStatus = Number(await r.u62());

		return new ObjectStream(subscribeId, trackAlias, groupId, objectId, objectSendOrder, objectStatus);
	}

	// Object status values from spec
	static readonly STATUS_NORMAL = 0x00;
	static readonly STATUS_OBJECT_NOT_EXIST = 0x01;
	static readonly STATUS_GROUP_NOT_EXIST = 0x02;
	static readonly STATUS_END_OF_GROUP = 0x03;
	static readonly STATUS_END_OF_TRACK = 0x04;
}

export class ObjectDatagram implements Message.Encode {
	subscribeId: bigint;
	trackAlias: bigint;
	groupId: bigint;
	objectId: bigint;
	objectSendOrder: number;
	objectStatus: number;
	objectPayload: Uint8Array;

	constructor(
		subscribeId: bigint,
		trackAlias: bigint,
		groupId: bigint,
		objectId: bigint,
		objectSendOrder: number,
		objectStatus: number,
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

	async encodeBody(w: Writer): Promise<void> {
		await w.u62(this.subscribeId);
		await w.u62(this.trackAlias);
		await w.u62(this.groupId);
		await w.u62(this.objectId);
		await w.u62(BigInt(this.objectSendOrder));
		await w.u62(BigInt(this.objectStatus));
		await w.write(this.objectPayload);
	}

	static async decodeBody(r: Reader): Promise<ObjectDatagram> {
		const subscribeId = await r.u62();
		const trackAlias = await r.u62();
		const groupId = await r.u62();
		const objectId = await r.u62();
		const objectSendOrder = Number(await r.u62());
		const objectStatus = Number(await r.u62());
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

// Track status message for communicating track-level state
export class TrackStatus implements Message.Encode {
	static StreamID = 0x08;

	trackNamespace: string;
	trackName: string;
	statusCode: number;
	lastGroupId: bigint;
	lastObjectId: bigint;

	constructor(
		trackNamespace: string,
		trackName: string,
		statusCode: number,
		lastGroupId: bigint,
		lastObjectId: bigint,
	) {
		this.trackNamespace = trackNamespace;
		this.trackName = trackName;
		this.statusCode = statusCode;
		this.lastGroupId = lastGroupId;
		this.lastObjectId = lastObjectId;
	}

	async encode(w: Writer): Promise<void> {
		await Message.encode(w, this, this.encodeBody);
	}

	async encodeBody(w: Writer): Promise<void> {
		await w.string(this.trackNamespace);
		await w.string(this.trackName);
		await w.u62(BigInt(this.statusCode));
		await w.u62(this.lastGroupId);
		await w.u62(this.lastObjectId);
	}

	static async decodeBody(r: Reader): Promise<TrackStatus> {
		const trackNamespace = await r.string();
		const trackName = await r.string();
		const statusCode = Number(await r.u62());
		const lastGroupId = await r.u62();
		const lastObjectId = await r.u62();

		return new TrackStatus(trackNamespace, trackName, statusCode, lastGroupId, lastObjectId);
	}

	// Track status codes
	static readonly STATUS_IN_PROGRESS = 0x00;
	static readonly STATUS_NOT_FOUND = 0x01;
	static readonly STATUS_NOT_AUTHORIZED = 0x02;
	static readonly STATUS_ENDED = 0x03;
}
