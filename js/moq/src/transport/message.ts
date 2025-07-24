import { Reader, Writer } from "../stream";

/**
 * Interface for messages that are automatically size-prefixed during encoding/decoding.
 */
export interface Encode {
	encodeBody(w: Writer): Promise<void>;
}

export interface Decode<T extends Encode> {
	decodeBody(r: Reader): Promise<T>;
}

export async function encode<T extends Encode>(w: Writer, msg: T, f: (w: Writer, msg: T) => Promise<void>) {
	const temp = new Uint8Array(16 * 1024);
	const writer = new Writer(
		new WritableStream({
			write: (chunk) => {
				if (temp.byteLength < chunk.byteLength) {
					throw new Error("message too large");
				}
				temp.set(chunk);
			},
		}),
	);

	await f(writer, msg);
	writer.close();

	await w.u53(temp.byteLength);
	await w.write(temp.slice(0, temp.byteLength));
}

export async function decode<T extends Encode>(r: Reader, decode: Decode<T>): Promise<T> {
	const size = await r.u53();
	const payload = await r.read(size);

	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(payload);
			controller.close();
		},
	});

	const reader = new Reader(stream);
	return decode.decodeBody(reader);
}
