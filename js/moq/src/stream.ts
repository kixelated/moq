const MAX_U6 = 2 ** 6 - 1;
const MAX_U14 = 2 ** 14 - 1;
const MAX_U30 = 2 ** 30 - 1;
const MAX_U31 = 2 ** 31 - 1;
const MAX_U53 = Number.MAX_SAFE_INTEGER;

// TODO: Figure out why webpack is converting this to Math.pow
//const MAX_U62: bigint = 2n ** 62n - 1n;

const MAX_READ_SIZE = 1024 * 1024 * 64; // don't allocate more than 64MB for a message

export class Stream {
	reader: Reader;
	writer: Writer;

	constructor(props: {
		writable: WritableStream<Uint8Array>;
		readable: ReadableStream<Uint8Array>;
	}) {
		this.writer = new Writer(props.writable);
		this.reader = new Reader(props.readable);
	}

	static async accept(quic: WebTransport): Promise<Stream | undefined> {
		for (;;) {
			const reader =
				quic.incomingBidirectionalStreams.getReader() as ReadableStreamDefaultReader<WebTransportBidirectionalStream>;
			const next = await reader.read();
			reader.releaseLock();

			if (next.done) return;
			return new Stream(next.value);
		}
	}

	static async open(quic: WebTransport, priority?: number): Promise<Stream> {
		return new Stream(await quic.createBidirectionalStream({ sendOrder: priority }));
	}

	close() {
		this.writer.close();
		this.reader.stop(new Error("cancel"));
	}

	abort(reason: Error) {
		this.writer.reset(reason);
		this.reader.stop(reason);
	}
}

// Reader wraps a stream and provides convience methods for reading pieces from a stream
// Unfortunately we can't use a BYOB reader because it's not supported with WebTransport+WebWorkers yet.
export class Reader {
	#buffer: Uint8Array;
	#stream?: ReadableStream<Uint8Array>; // if undefined, the buffer is consumed then EOF
	#reader?: ReadableStreamDefaultReader<Uint8Array>;

	// Either stream or buffer MUST be provided.
	constructor(stream: ReadableStream<Uint8Array>, buffer?: Uint8Array);
	constructor(stream: undefined, buffer: Uint8Array);
	constructor(stream?: ReadableStream<Uint8Array>, buffer?: Uint8Array) {
		this.#buffer = buffer ?? new Uint8Array();
		this.#stream = stream;
		this.#reader = this.#stream?.getReader();
	}

	// Adds more data to the buffer, returning true if more data was added.
	async #fill(): Promise<boolean> {
		const result = await this.#reader?.read();
		if (!result || result.done) {
			return false;
		}

		const buffer = new Uint8Array(result.value);

		if (this.#buffer.byteLength === 0) {
			this.#buffer = buffer;
		} else {
			const temp = new Uint8Array(this.#buffer.byteLength + buffer.byteLength);
			temp.set(this.#buffer);
			temp.set(buffer, this.#buffer.byteLength);
			this.#buffer = temp;
		}

		return true;
	}

	// Add more data to the buffer until it's at least size bytes.
	async #fillTo(size: number) {
		if (size > MAX_READ_SIZE) {
			throw new Error(`read size ${size} exceeds max size ${MAX_READ_SIZE}`);
		}

		while (this.#buffer.byteLength < size) {
			if (!(await this.#fill())) {
				throw new Error("unexpected end of stream");
			}
		}
	}

	// Consumes the first size bytes of the buffer.
	#slice(size: number): Uint8Array {
		const result = new Uint8Array(this.#buffer.buffer, this.#buffer.byteOffset, size);
		this.#buffer = new Uint8Array(this.#buffer.buffer, this.#buffer.byteOffset + size, this.#buffer.byteLength - size);

		return result;
	}

	async read(size: number): Promise<Uint8Array> {
		if (size === 0) return new Uint8Array();

		await this.#fillTo(size);
		return this.#slice(size);
	}

	async readAll(): Promise<Uint8Array> {
		while (await this.#fill()) {
			// keep going
		}
		return this.#slice(this.#buffer.byteLength);
	}

	async string(): Promise<string> {
		const length = await this.u53();
		const buffer = await this.read(length);
		return new TextDecoder().decode(buffer);
	}

	// Reads a message with a varint size prefix.
	async message<T>(f: (r: Reader) => Promise<T>): Promise<T> {
		const size = await this.u53();
		const messageData = await this.read(size);

		const limit = new Reader(undefined, messageData);
		const msg = await f(limit);

		// Check that we consumed exactly the right number of bytes
		if (!(await limit.done())) {
			throw new Error("Message decoding consumed too few bytes");
		}

		return msg;
	}

	async messageMaybe<T>(f: (r: Reader) => Promise<T>): Promise<T | undefined> {
		if (await this.done()) return;
		return await this.message(f);
	}

	async u8(): Promise<number> {
		await this.#fillTo(1);
		return this.#slice(1)[0];
	}

	// Returns a Number using 53-bits, the max Javascript can use for integer math
	async u53(): Promise<number> {
		const v = await this.u62();
		if (v > MAX_U53) {
			throw new Error("value larger than 53-bits; use v62 instead");
		}

		return Number(v);
	}

	// NOTE: Returns a bigint instead of a number since it may be larger than 53-bits
	async u62(): Promise<bigint> {
		await this.#fillTo(1);
		const size = (this.#buffer[0] & 0xc0) >> 6;

		if (size === 0) {
			const first = this.#slice(1)[0];
			return BigInt(first) & 0x3fn;
		}
		if (size === 1) {
			await this.#fillTo(2);
			const slice = this.#slice(2);
			const view = new DataView(slice.buffer, slice.byteOffset, slice.byteLength);

			return BigInt(view.getInt16(0)) & 0x3fffn;
		}
		if (size === 2) {
			await this.#fillTo(4);
			const slice = this.#slice(4);
			const view = new DataView(slice.buffer, slice.byteOffset, slice.byteLength);

			return BigInt(view.getUint32(0)) & 0x3fffffffn;
		}
		await this.#fillTo(8);
		const slice = this.#slice(8);
		const view = new DataView(slice.buffer, slice.byteOffset, slice.byteLength);

		return view.getBigUint64(0) & 0x3fffffffffffffffn;
	}

	// Returns false if there is more data to read, blocking if it hasn't been received yet.
	async done(): Promise<boolean> {
		if (this.#buffer.byteLength > 0) return false;
		return !(await this.#fill());
	}

	stop(reason: unknown) {
		this.#reader?.cancel(reason).catch(() => void 0);
	}

	async closed() {
		await this.#reader?.closed;
	}
}

// Writer wraps a stream and writes chunks of data
export class Writer {
	#writer: WritableStreamDefaultWriter<Uint8Array>;
	#stream: WritableStream<Uint8Array>;

	// Scratch buffer for writing varints.
	// Fixed at 8 bytes.
	#scratch: ArrayBuffer;

	// Scratch buffer for writing messages.
	// Starts at 0 bytes, grows as needed.
	#message: ArrayBuffer;

	constructor(stream: WritableStream<Uint8Array>) {
		this.#stream = stream;
		this.#scratch = new ArrayBuffer(8);
		this.#message = new ArrayBuffer(0);
		this.#writer = this.#stream.getWriter();
	}

	async u8(v: number) {
		await this.write(setUint8(this.#scratch, v));
	}

	async i32(v: number) {
		if (Math.abs(v) > MAX_U31) {
			throw new Error(`overflow, value larger than 32-bits: ${v.toString()}`);
		}

		// We don't use a VarInt, so it always takes 4 bytes.
		// This could be improved but nothing is standardized yet.
		await this.write(setInt32(this.#scratch, v));
	}

	async u53(v: number) {
		if (v < 0) {
			throw new Error(`underflow, value is negative: ${v.toString()}`);
		}
		if (v > MAX_U53) {
			throw new Error(`overflow, value larger than 53-bits: ${v.toString()}`);
		}

		await this.write(setVint53(this.#scratch, v));
	}

	async u62(v: bigint) {
		if (v < 0) {
			throw new Error(`underflow, value is negative: ${v.toString()}`);
		}
		/*
		if (v >= MAX_U62) {
			throw new Error(`overflow, value larger than 62-bits: ${v}`);
		}
		*/

		await this.write(setVint62(this.#scratch, v));
	}

	async write(v: Uint8Array) {
		await this.#writer.write(v);
	}

	// Writes a message with a varint size prefix.
	async message(f: (w: Writer) => Promise<void>) {
		let scratch = new Uint8Array(this.#message, 0, 0);

		const temp = new Writer(
			new WritableStream({
				write(chunk: Uint8Array) {
					const needed = scratch.byteLength + chunk.byteLength;
					if (needed > scratch.buffer.byteLength) {
						// Resize the buffer to the needed size.
						const capacity = Math.max(needed, scratch.buffer.byteLength * 2);
						const newBuffer = new ArrayBuffer(capacity);
						const newScratch = new Uint8Array(newBuffer, 0, needed);

						// Copy the old data into the new buffer.
						newScratch.set(scratch);

						// Copy the new chunk into the new buffer.
						newScratch.set(chunk, scratch.byteLength);

						scratch = newScratch;
					} else {
						// Copy chunk data into buffer
						scratch = new Uint8Array(scratch.buffer, 0, needed);
						scratch.set(chunk, needed - chunk.byteLength);
					}
				},
			}),
		);

		await f(temp);
		temp.close();
		await temp.closed();

		await this.u53(scratch.byteLength);
		await this.write(scratch);

		this.#message = scratch.buffer;
	}

	async string(str: string) {
		const data = new TextEncoder().encode(str);
		await this.u53(data.byteLength);
		await this.write(data);
	}

	close() {
		this.#writer.close().catch(() => void 0);
	}

	async closed(): Promise<void> {
		await this.#writer.closed;
	}

	reset(reason: unknown) {
		this.#writer.abort(reason).catch(() => void 0);
	}

	static async open(quic: WebTransport): Promise<Writer> {
		const writable = (await quic.createUnidirectionalStream()) as WritableStream<Uint8Array>;
		return new Writer(writable);
	}
}

export function setUint8(dst: ArrayBuffer, v: number): Uint8Array {
	const buffer = new Uint8Array(dst, 0, 1);
	buffer[0] = v;
	return buffer;
}

export function setUint16(dst: ArrayBuffer, v: number): Uint8Array {
	const view = new DataView(dst, 0, 2);
	view.setUint16(0, v);
	return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

export function setInt32(dst: ArrayBuffer, v: number): Uint8Array {
	const view = new DataView(dst, 0, 4);
	view.setInt32(0, v);
	return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

export function setUint32(dst: ArrayBuffer, v: number): Uint8Array {
	const view = new DataView(dst, 0, 4);
	view.setUint32(0, v);
	return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

export function setVint53(dst: ArrayBuffer, v: number): Uint8Array {
	if (v <= MAX_U6) {
		return setUint8(dst, v);
	}
	if (v <= MAX_U14) {
		return setUint16(dst, v | 0x4000);
	}
	if (v <= MAX_U30) {
		return setUint32(dst, v | 0x80000000);
	}
	if (v <= MAX_U53) {
		return setUint64(dst, BigInt(v) | 0xc000000000000000n);
	}
	throw new Error(`overflow, value larger than 53-bits: ${v.toString()}`);
}

export function setVint62(dst: ArrayBuffer, v: bigint): Uint8Array {
	if (v < MAX_U6) {
		return setUint8(dst, Number(v));
	}
	if (v < MAX_U14) {
		return setUint16(dst, Number(v) | 0x4000);
	}
	if (v <= MAX_U30) {
		return setUint32(dst, Number(v) | 0x80000000);
	}
	//if (v <= MAX_U62) {
	return setUint64(dst, BigInt(v) | 0xc000000000000000n);
	//}
	//throw new Error(`overflow, value larger than 62-bits: ${v}`);
}

export function setUint64(dst: ArrayBuffer, v: bigint): Uint8Array {
	const view = new DataView(dst, 0, 8);
	view.setBigUint64(0, v);
	return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

// Returns the next stream from the connection
export class Readers {
	#reader: ReadableStreamDefaultReader<ReadableStream<Uint8Array>>;

	constructor(quic: WebTransport) {
		this.#reader = quic.incomingUnidirectionalStreams.getReader() as ReadableStreamDefaultReader<
			ReadableStream<Uint8Array>
		>;
	}

	async next(): Promise<Reader | undefined> {
		const next = await this.#reader.read();
		if (next.done) return;
		return new Reader(next.value);
	}

	close() {
		this.#reader.cancel();
	}
}
