import assert from "node:assert";
import test from "node:test";
import { Writer, Reader } from "./stream";

// Helper to create a writable stream that captures written data
function createTestWritableStream(): { stream: WritableStream<Uint8Array>; written: Uint8Array[] } {
	const written: Uint8Array[] = [];
	const stream = new WritableStream<Uint8Array>({
		write(chunk) {
			written.push(new Uint8Array(chunk));
		},
	});
	return { stream, written };
}

// Helper to concatenate written chunks
function concatChunks(chunks: Uint8Array[]): Uint8Array {
	const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

test("Writer u8", async () => {
	const { stream, written } = createTestWritableStream();
	const writer = new Writer(stream);

	await writer.u8(42);
	await writer.u8(255);
	
	writer.close();
	await writer.closed();

	assert.strictEqual(written.length, 2);
	assert.deepEqual(written[0], new Uint8Array([42]));
	assert.deepEqual(written[1], new Uint8Array([255]));
});

test("Writer i32", async () => {
	const { stream, written } = createTestWritableStream();
	const writer = new Writer(stream);

	await writer.i32(0);
	await writer.i32(-1);
	await writer.i32(1000);
	
	writer.close();
	await writer.closed();

	const result = concatChunks(written);
	assert.strictEqual(result.byteLength, 12); // 3 * 4 bytes

	// Read back the values
	const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
	assert.strictEqual(view.getInt32(0), 0);
	assert.strictEqual(view.getInt32(4), -1);
	assert.strictEqual(view.getInt32(8), 1000);
});

test("Writer u53", async () => {
	const { stream, written } = createTestWritableStream();
	const writer = new Writer(stream);

	await writer.u53(0);
	await writer.u53(63); // MAX_U6
	await writer.u53(64); // MIN for 2-byte varint
	await writer.u53(16383); // MAX_U14
	await writer.u53(16384); // MIN for 4-byte varint
	
	writer.close();
	await writer.closed();

	const result = concatChunks(written);
	
	// Verify the varint encoding sizes
	assert.strictEqual(written[0].byteLength, 1); // 0 fits in 1 byte
	assert.strictEqual(written[1].byteLength, 1); // 63 fits in 1 byte
	assert.strictEqual(written[2].byteLength, 2); // 64 needs 2 bytes
	assert.strictEqual(written[3].byteLength, 2); // 16383 fits in 2 bytes
	assert.strictEqual(written[4].byteLength, 4); // 16384 needs 4 bytes
});

test("Writer string", async () => {
	const { stream, written } = createTestWritableStream();
	const writer = new Writer(stream);

	await writer.string("hello");
	await writer.string("🎉");
	
	writer.close();
	await writer.closed();

	const result = concatChunks(written);
	
	// Create a reader to parse the result
	const reader = new Reader(undefined, result);
	
	const str1 = await reader.string();
	const str2 = await reader.string();
	
	assert.strictEqual(str1, "hello");
	assert.strictEqual(str2, "🎉");
});

test("Writer message with simple content", async () => {
	const { stream, written } = createTestWritableStream();
	const writer = new Writer(stream);

	await writer.message(async (w) => {
		await w.u8(42);
		await w.u8(84);
	});
	
	writer.close();
	await writer.closed();

	const result = concatChunks(written);
	
	// Create a reader to parse the result
	const reader = new Reader(undefined, result);
	
	// Read the message
	const messageContent = await reader.message(async (r) => {
		const a = await r.u8();
		const b = await r.u8();
		return { a, b };
	});
	
	assert.strictEqual(messageContent.a, 42);
	assert.strictEqual(messageContent.b, 84);
});

test("Writer message with varying sizes", async () => {
	const { stream, written } = createTestWritableStream();
	const writer = new Writer(stream);

	// Test small message
	await writer.message(async (w) => {
		await w.u8(1);
	});

	// Test medium message
	await writer.message(async (w) => {
		for (let i = 0; i < 100; i++) {
			await w.u8(i % 256);
		}
	});

	// Test large message that should trigger buffer resizing
	await writer.message(async (w) => {
		for (let i = 0; i < 1000; i++) {
			await w.u8(i % 256);
		}
	});
	
	writer.close();
	await writer.closed();

	const result = concatChunks(written);
	const reader = new Reader(undefined, result);
	
	// Read first message
	const msg1 = await reader.message(async (r) => {
		return await r.u8();
	});
	assert.strictEqual(msg1, 1);
	
	// Read second message
	const msg2 = await reader.message(async (r) => {
		const values = [];
		for (let i = 0; i < 100; i++) {
			values.push(await r.u8());
		}
		return values;
	});
	assert.strictEqual(msg2.length, 100);
	for (let i = 0; i < 100; i++) {
		assert.strictEqual(msg2[i], i % 256);
	}
	
	// Read third message
	const msg3 = await reader.message(async (r) => {
		const values = [];
		for (let i = 0; i < 1000; i++) {
			values.push(await r.u8());
		}
		return values;
	});
	assert.strictEqual(msg3.length, 1000);
	for (let i = 0; i < 1000; i++) {
		assert.strictEqual(msg3[i], i % 256);
	}
});

test("Writer message buffer length bug test", async () => {
	const { stream, written } = createTestWritableStream();
	const writer = new Writer(stream);

	// This test specifically targets the potential bug where the entire #scratch buffer
	// is written instead of just the actual message content length
	await writer.message(async (w) => {
		await w.u8(0xAA); // Distinctive byte pattern
		await w.u8(0xBB);
		await w.u8(0xCC);
	});
	
	writer.close();
	await writer.closed();

	const result = concatChunks(written);
	
	// The result should be: [varint length][0xAA][0xBB][0xCC]
	// If the bug exists, we might see the entire scratch buffer written
	
	const reader = new Reader(undefined, result);
	const messageLength = await reader.u53();
	
	// The message should be exactly 3 bytes
	assert.strictEqual(messageLength, 3, `Expected message length 3, got ${messageLength}. This suggests the entire scratch buffer was written instead of just the message content.`);
	
	const messageData = await reader.read(messageLength);
	assert.deepEqual(messageData, new Uint8Array([0xAA, 0xBB, 0xCC]));
	
	// Verify we've consumed all data
	assert.strictEqual(await reader.done(), true, "There should be no extra data after the message");
});

test("Writer message nested messages", async () => {
	const { stream, written } = createTestWritableStream();
	const writer = new Writer(stream);

	await writer.message(async (w) => {
		await w.u8(1);
		await w.message(async (w2) => {
			await w2.u8(2);
			await w2.u8(3);
		});
		await w.u8(4);
	});
	
	writer.close();
	await writer.closed();

	const result = concatChunks(written);
	const reader = new Reader(undefined, result);
	
	const outerMessage = await reader.message(async (r) => {
		const first = await r.u8();
		const innerMessage = await r.message(async (r2) => {
			const a = await r2.u8();
			const b = await r2.u8();
			return { a, b };
		});
		const last = await r.u8();
		return { first, innerMessage, last };
	});
	
	assert.strictEqual(outerMessage.first, 1);
	assert.strictEqual(outerMessage.innerMessage.a, 2);
	assert.strictEqual(outerMessage.innerMessage.b, 3);
	assert.strictEqual(outerMessage.last, 4);
});

// Helper to create a readable stream from data
function createTestReadableStream(data: Uint8Array): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(data);
			controller.close();
		}
	});
}

test("Reader u8", async () => {
	const data = new Uint8Array([42, 255, 0, 128]);
	const reader = new Reader(undefined, data);

	assert.strictEqual(await reader.u8(), 42);
	assert.strictEqual(await reader.u8(), 255);
	assert.strictEqual(await reader.u8(), 0);
	assert.strictEqual(await reader.u8(), 128);
	
	assert.strictEqual(await reader.done(), true);
});

test("Reader read with exact sizes", async () => {
	const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
	const reader = new Reader(undefined, data);

	const chunk1 = await reader.read(3);
	assert.deepEqual(chunk1, new Uint8Array([1, 2, 3]));

	const chunk2 = await reader.read(2);
	assert.deepEqual(chunk2, new Uint8Array([4, 5]));

	const chunk3 = await reader.read(3);
	assert.deepEqual(chunk3, new Uint8Array([6, 7, 8]));
	
	assert.strictEqual(await reader.done(), true);
});

test("Reader read with zero size", async () => {
	const data = new Uint8Array([1, 2, 3]);
	const reader = new Reader(undefined, data);

	const chunk = await reader.read(0);
	assert.deepEqual(chunk, new Uint8Array([]));
	
	// Original data should still be available
	const remaining = await reader.read(3);
	assert.deepEqual(remaining, new Uint8Array([1, 2, 3]));
});

test("Reader readAll", async () => {
	const data = new Uint8Array([1, 2, 3, 4, 5]);
	const reader = new Reader(undefined, data);

	// Read some data first
	await reader.read(2);
	
	// readAll should get the remaining data
	const remaining = await reader.readAll();
	assert.deepEqual(remaining, new Uint8Array([3, 4, 5]));
	
	assert.strictEqual(await reader.done(), true);
});

test("Reader u53 varint decoding", async () => {
	// Test various varint sizes
	const writer = new Writer(new WritableStream({ write() {} }));
	const testValues = [0, 63, 64, 16383, 16384, 1073741823, 1073741824];
	
	const { stream, written } = createTestWritableStream();
	const testWriter = new Writer(stream);
	
	for (const value of testValues) {
		await testWriter.u53(value);
	}
	
	testWriter.close();
	await testWriter.closed();
	
	const data = concatChunks(written);
	const reader = new Reader(undefined, data);
	
	for (const expectedValue of testValues) {
		const actualValue = await reader.u53();
		assert.strictEqual(actualValue, expectedValue, `Failed for value ${expectedValue}`);
	}
	
	assert.strictEqual(await reader.done(), true);
});

test("Reader u62 varint decoding", async () => {
	const testValues = [0n, 63n, 64n, 16383n, 16384n, 1073741823n, 1073741824n, 9007199254740991n]; // MAX_U53
	
	const { stream, written } = createTestWritableStream();
	const testWriter = new Writer(stream);
	
	for (const value of testValues) {
		await testWriter.u62(value);
	}
	
	testWriter.close();
	await testWriter.closed();
	
	const data = concatChunks(written);
	const reader = new Reader(undefined, data);
	
	for (const expectedValue of testValues) {
		const actualValue = await reader.u62();
		assert.strictEqual(actualValue, expectedValue, `Failed for value ${expectedValue}`);
	}
	
	assert.strictEqual(await reader.done(), true);
});

test("Reader string decoding", async () => {
	const testStrings = ["hello", "🎉", "", "world with spaces", "multi\nline\nstring"];
	
	const { stream, written } = createTestWritableStream();
	const writer = new Writer(stream);
	
	for (const str of testStrings) {
		await writer.string(str);
	}
	
	writer.close();
	await writer.closed();
	
	const data = concatChunks(written);
	const reader = new Reader(undefined, data);
	
	for (const expectedString of testStrings) {
		const actualString = await reader.string();
		assert.strictEqual(actualString, expectedString, `Failed for string "${expectedString}"`);
	}
	
	assert.strictEqual(await reader.done(), true);
});

test("Reader string with max length", async () => {
	const { stream, written } = createTestWritableStream();
	const writer = new Writer(stream);
	
	await writer.string("hello");
	
	writer.close();
	await writer.closed();
	
	const data = concatChunks(written);
	const reader = new Reader(undefined, data);
	
	// Should succeed with sufficient max length
	const str1 = await reader.string(10);
	assert.strictEqual(str1, "hello");
});

test("Reader string max length exceeded", async () => {
	const { stream, written } = createTestWritableStream();
	const writer = new Writer(stream);
	
	await writer.string("hello world");
	
	writer.close();
	await writer.closed();
	
	const data = concatChunks(written);
	const reader = new Reader(undefined, data);
	
	// Should throw when max length is exceeded
	await assert.rejects(
		async () => await reader.string(5),
		/string length 11 exceeds max length 5/
	);
});

test("Reader message decoding", async () => {
	const { stream, written } = createTestWritableStream();
	const writer = new Writer(stream);

	// Write a message containing u8 values
	await writer.message(async (w) => {
		await w.u8(42);
		await w.u8(84);
		await w.u8(126);
	});
	
	writer.close();
	await writer.closed();

	const data = concatChunks(written);
	const reader = new Reader(undefined, data);
	
	const result = await reader.message(async (r) => {
		const a = await r.u8();
		const b = await r.u8();
		const c = await r.u8();
		return [a, b, c];
	});
	
	assert.deepEqual(result, [42, 84, 126]);
	assert.strictEqual(await reader.done(), true);
});

test("Reader message exact consumption", async () => {
	const { stream, written } = createTestWritableStream();
	const writer = new Writer(stream);

	await writer.message(async (w) => {
		await w.u8(1);
		await w.u8(2);
	});
	
	writer.close();
	await writer.closed();

	const data = concatChunks(written);
	const reader = new Reader(undefined, data);
	
	// Reading too few bytes should throw
	await assert.rejects(
		async () => await reader.message(async (r) => {
			await r.u8(); // Only read 1 byte when message contains 2
		}),
		/Message decoding consumed too few bytes/
	);
});

test("Reader messageMaybe with data", async () => {
	const { stream, written } = createTestWritableStream();
	const writer = new Writer(stream);

	await writer.message(async (w) => {
		await w.u8(42);
	});
	
	writer.close();
	await writer.closed();

	const data = concatChunks(written);
	const reader = new Reader(undefined, data);
	
	const result = await reader.messageMaybe(async (r) => {
		return await r.u8();
	});
	
	assert.strictEqual(result, 42);
});

test("Reader messageMaybe with no data", async () => {
	const reader = new Reader(undefined, new Uint8Array([]));
	
	const result = await reader.messageMaybe(async (r) => {
		return await r.u8();
	});
	
	assert.strictEqual(result, undefined);
});

test("Reader from stream", async () => {
	const chunks = [
		new Uint8Array([1, 2, 3]),
		new Uint8Array([4, 5]),
		new Uint8Array([6, 7, 8, 9])
	];
	
	const stream = new ReadableStream({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(chunk);
			}
			controller.close();
		}
	});
	
	const reader = new Reader(stream);
	
	// Read all data
	const result = await reader.readAll();
	assert.deepEqual(result, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
});

test("Reader stream with partial reads", async () => {
	const chunks = [
		new Uint8Array([1, 2]),
		new Uint8Array([3, 4, 5]),
		new Uint8Array([6])
	];
	
	const stream = new ReadableStream({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(chunk);
			}
			controller.close();
		}
	});
	
	const reader = new Reader(stream);
	
	// Read specific amounts that cross chunk boundaries
	const first = await reader.read(3); // Should span first two chunks
	assert.deepEqual(first, new Uint8Array([1, 2, 3]));
	
	const second = await reader.read(2);
	assert.deepEqual(second, new Uint8Array([4, 5]));
	
	const third = await reader.read(1);
	assert.deepEqual(third, new Uint8Array([6]));
	
	assert.strictEqual(await reader.done(), true);
});