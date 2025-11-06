import type * as Path from "../path.ts";
import type { Reader, Writer } from "../stream.ts";
import { GroupOrder } from "./group.ts";
import * as Message from "./message.ts";
import * as Namespace from "./namespace.ts";
import { Parameters } from "./parameters.ts";

// PUBLISH messages are new in draft-14 but not yet fully supported
// These are stubs matching the Rust implementation

export class Publish {
	static id = 0x1d;

	requestId: bigint;
	trackNamespace: Path.Valid;
	trackName: string;
	trackAlias: bigint;
	groupOrder: GroupOrder;
	contentExists: boolean;
	largest: { groupId: bigint; objectId: bigint } | undefined;
	forward: boolean;

	constructor(
		requestId: bigint,
		trackNamespace: Path.Valid,
		trackName: string,
		trackAlias: bigint,
		groupOrder: GroupOrder,
		contentExists: boolean,
		largest: { groupId: bigint; objectId: bigint } | undefined,
		forward: boolean,
	) {
		this.requestId = requestId;
		this.trackNamespace = trackNamespace;
		this.trackName = trackName;
		this.trackAlias = trackAlias;
		this.groupOrder = groupOrder;
		this.contentExists = contentExists;
		this.largest = largest;
		this.forward = forward;
	}

	async #encode(w: Writer): Promise<void> {
		await w.u62(this.requestId);
		await Namespace.encode(w, this.trackNamespace);
		await w.string(this.trackName);
		await w.u62(this.trackAlias);
		await this.groupOrder.encode(w);
		await w.bool(this.contentExists);
		if (this.contentExists !== !!this.largest) {
			throw new Error("contentExists and largest must both be true or false");
		}
		if (this.largest) {
			await w.u62(this.largest.groupId);
			await w.u62(this.largest.objectId);
		}
		await w.bool(this.forward);
		await w.u53(0); // size of parameters
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<Publish> {
		return Message.decode(r, Publish.#decode);
	}

	static async #decode(r: Reader): Promise<Publish> {
		const requestId = await r.u62();
		const trackNamespace = await Namespace.decode(r);
		const trackName = await r.string();
		const trackAlias = await r.u62();
		const groupOrder = await GroupOrder.decode(r);
		const contentExists = await r.bool();
		const largest = contentExists ? { groupId: await r.u62(), objectId: await r.u62() } : undefined;
		const forward = await r.bool();
		await Parameters.decode(r); // ignore parameters
		return new Publish(
			requestId,
			trackNamespace,
			trackName,
			trackAlias,
			groupOrder,
			contentExists,
			largest,
			forward,
		);
	}
}

export class PublishOk {
	static id = 0x1e;

	async #encode(_w: Writer): Promise<void> {
		throw new Error("PUBLISH_OK messages are not supported");
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<PublishOk> {
		return Message.decode(r, PublishOk.#decode);
	}

	static async #decode(_r: Reader): Promise<PublishOk> {
		throw new Error("PUBLISH_OK messages are not supported");
	}
}

export class PublishError {
	static id = 0x1f;

	requestId: bigint;
	errorCode: number;
	reasonPhrase: string;

	constructor(requestId: bigint, errorCode: number, reasonPhrase: string) {
		this.requestId = requestId;
		this.errorCode = errorCode;
		this.reasonPhrase = reasonPhrase;
	}

	async #encode(w: Writer): Promise<void> {
		await w.u62(this.requestId);
		await w.u62(BigInt(this.errorCode));
		await w.string(this.reasonPhrase);
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<PublishError> {
		return Message.decode(r, PublishError.#decode);
	}

	static async #decode(r: Reader): Promise<PublishError> {
		const requestId = await r.u62();
		const errorCode = Number(await r.u62());
		const reasonPhrase = await r.string();
		return new PublishError(requestId, errorCode, reasonPhrase);
	}
}
