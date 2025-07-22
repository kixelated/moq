import { Reader, Writer } from "./stream";

/**
 * Interface for messages that are automatically size-prefixed during encoding/decoding.
 */
export interface Encode {
	encodeBody(w: Writer): Promise<void>;
}

export interface Decode<T extends Encode> {
	decodeBody(r: Reader): Promise<T>;
}

/**
 * Encode a message with a size prefix.
 */
export async function encode(message: Encode, writer: Writer): Promise<void> {
	// Use a growing buffer to collect all the data
	// Most messages are small, so start with a small buffer.
	// We use data.byteLength as the length and data.buffer.byteLength as the capacity.
	let data = new Uint8Array(new ArrayBuffer(64), 0, 0);

	const temp = new Writer(
		new WritableStream({
			write(chunk: Uint8Array) {
				const needed = data.byteLength + chunk.byteLength;
				if (needed > data.buffer.byteLength) {
					// Resize the buffer to the needed size.
					const capacity = Math.max(needed, data.buffer.byteLength * 2);
					const newBuffer = new ArrayBuffer(capacity);
					const newData = new Uint8Array(newBuffer, 0, needed);

					// Copy the old data into the new buffer.
					newData.set(data);

					// Copy the new chunk into the new buffer.
					newData.set(chunk, data.byteLength);

					data = newData;
				} else {
					// Copy chunk data into buffer
					data = new Uint8Array(data.buffer, 0, needed);
					data.set(chunk, needed - chunk.byteLength);
				}
			},
		}),
	);

	await message.encodeBody(temp);
	temp.close();
	await temp.closed();

	// Write size prefix
	await writer.u53(data.byteLength);

	// Write the contiguous buffer
	await writer.write(data);
}

/**
 * Decode a size-prefixed message, ensuring exact size consumption.
 */
export async function decode<T extends Encode>(MessageClass: Decode<T>, reader: Reader): Promise<T> {
	const size = await reader.u53();
	const messageData = await reader.read(size);

	// Create a limited reader that contains exactly `size` bytes
	const limitedStream = new ReadableStream({
		start(controller) {
			controller.enqueue(messageData);
			controller.close();
		},
	});

	const limitedReader = new Reader(limitedStream);
	const result = await MessageClass.decodeBody(limitedReader);

	// Check that we consumed exactly the right number of bytes
	if (!(await limitedReader.done())) {
		throw new Error("Message decoding consumed too few bytes");
	}

	return result;
}

export async function decodeMaybe<T extends Encode>(MessageClass: Decode<T>, reader: Reader): Promise<T | undefined> {
	if (await reader.done()) return;
	return await decode(MessageClass, reader);
}
