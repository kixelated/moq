import type * as Moq from "@kixelated/moq";

export interface Source {
	byteLength: number;
	copyTo(buffer: Uint8Array): void;
}

export function encode(source: Uint8Array | Source, timestamp: number): Uint8Array {
	const data = new Uint8Array(8 + (source instanceof Uint8Array ? source.byteLength : source.byteLength));
	const size = setVint53(data, timestamp).byteLength;
	if (source instanceof Uint8Array) {
		data.set(source, size);
	} else {
		source.copyTo(data.subarray(size));
	}
	return data.subarray(0, (source instanceof Uint8Array ? source.byteLength : source.byteLength) + size);
}

// NOTE: A keyframe is always the first frame in a group, so it's not encoded on the wire.
export function decode(buffer: Uint8Array): { data: Uint8Array; timestamp: number } {
	const [timestamp, data] = getVint53(buffer);
	return { timestamp, data };
}

export class Producer {
	#track: Moq.TrackProducer;
	#group?: Moq.GroupProducer;

	constructor(track: Moq.TrackProducer) {
		this.#track = track;
	}

	encode(data: Uint8Array | Source, timestamp: number, keyframe: boolean) {
		if (keyframe) {
			this.#group?.close();
			this.#group = this.#track.appendGroup();
		} else if (!this.#group) {
			throw new Error("must start with a keyframe");
		}

		this.#group?.writeFrame(encode(data, timestamp));
	}

	consume(): Consumer {
		return new Consumer(this.#track.consume());
	}

	close() {
		this.#track.close();
		this.#group?.close();
	}
}

export class Consumer {
	#track: Moq.TrackConsumer;

	constructor(track: Moq.TrackConsumer) {
		this.#track = track;
	}

	async decode(): Promise<{ data: Uint8Array; timestamp: number; keyframe: boolean } | undefined> {
		const next = await this.#track.nextFrame();
		if (!next) return undefined;

		const { timestamp, data } = decode(next.data);
		return { data, timestamp, keyframe: next.frame === 0 };
	}
}

const MAX_U6 = 2 ** 6 - 1;
const MAX_U14 = 2 ** 14 - 1;
const MAX_U30 = 2 ** 30 - 1;
const MAX_U53 = Number.MAX_SAFE_INTEGER;
//const MAX_U62: bigint = 2n ** 62n - 1n;

// QUIC VarInt
function getVint53(buf: Uint8Array): [number, Uint8Array] {
	const size = 1 << ((buf[0] & 0xc0) >> 6);

	const view = new DataView(buf.buffer, buf.byteOffset, size);
	const remain = new Uint8Array(buf.buffer, buf.byteOffset + size, buf.byteLength - size);
	let v: number;

	if (size === 1) {
		v = buf[0] & 0x3f;
	} else if (size === 2) {
		v = view.getInt16(0) & 0x3fff;
	} else if (size === 4) {
		v = view.getUint32(0) & 0x3fffffff;
	} else if (size === 8) {
		// NOTE: Precision loss above 2^52
		v = Number(view.getBigUint64(0) & 0x3fffffffffffffffn);
	} else {
		throw new Error("impossible");
	}

	return [v, remain];
}

function setVint53(dst: Uint8Array, v: number): Uint8Array {
	if (v <= MAX_U6) {
		dst[0] = v;
		return new Uint8Array(dst.buffer, dst.byteOffset, 1);
	}

	if (v <= MAX_U14) {
		const view = new DataView(dst.buffer, dst.byteOffset, 2);
		view.setUint16(0, v | 0x4000);
		return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
	}

	if (v <= MAX_U30) {
		const view = new DataView(dst.buffer, dst.byteOffset, 4);
		view.setUint32(0, v | 0x80000000);
		return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
	}

	if (v <= MAX_U53) {
		const view = new DataView(dst.buffer, dst.byteOffset, 8);
		view.setBigUint64(0, BigInt(v) | 0xc000000000000000n);
		return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
	}

	throw new Error(`overflow, value larger than 53-bits: ${v}`);
}
