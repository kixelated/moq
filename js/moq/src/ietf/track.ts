import type * as Path from "../path";
import type { Reader, Writer } from "../stream";
import * as Namespace from "./namespace";

export class TrackStatusRequest {
	static id = 0x0d;

	trackNamespace: Path.Valid;
	trackName: string;

	constructor(trackNamespace: Path.Valid, trackName: string) {
		this.trackNamespace = trackNamespace;
		this.trackName = trackName;
	}

	async encodeMessage(w: Writer): Promise<void> {
		await Namespace.encode(w, this.trackNamespace);
		await w.string(this.trackName);
	}

	static async decodeMessage(r: Reader): Promise<TrackStatusRequest> {
		const trackNamespace = await Namespace.decode(r);
		const trackName = await r.string();
		return new TrackStatusRequest(trackNamespace, trackName);
	}
}

// Track status message for communicating track-level state
export class TrackStatus {
	static id = 0x0e;

	trackNamespace: Path.Valid;
	trackName: string;
	statusCode: number;
	lastGroupId: bigint;
	lastObjectId: bigint;

	constructor(
		trackNamespace: Path.Valid,
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

	async encodeMessage(w: Writer): Promise<void> {
		await Namespace.encode(w, this.trackNamespace);
		await w.string(this.trackName);
		await w.u62(BigInt(this.statusCode));
		await w.u62(this.lastGroupId);
		await w.u62(this.lastObjectId);
	}

	static async decodeMessage(r: Reader): Promise<TrackStatus> {
		const trackNamespace = await Namespace.decode(r);
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
