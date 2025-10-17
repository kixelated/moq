import assert from "node:assert";
import test from "node:test";
import { Reader, Writer } from "../stream.ts";
import * as Subscribe from "./subscribe.ts";
import * as Announce from "./announce.ts";
import * as GoAway from "./goaway.ts";
import * as Track from "./track.ts";
import * as Path from "../path.ts";

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

// Helper to encode a message
async function encodeMessage<T extends { encodeMessage(w: Writer): Promise<void> }>(message: T): Promise<Uint8Array> {
	const { stream, written } = createTestWritableStream();
	const writer = new Writer(stream);
	await message.encodeMessage(writer);
	writer.close();
	await writer.closed;
	return concatChunks(written);
}

// Helper to decode a message
async function decodeMessage<T>(
	bytes: Uint8Array,
	decoder: (r: Reader) => Promise<T>,
): Promise<T> {
	const reader = new Reader(undefined, bytes);
	return await decoder(reader);
}

// Subscribe tests
test("Subscribe: round trip", async () => {
	const msg = new Subscribe.Subscribe(1n, 2n, Path.from("test"), "video", 128);

	const encoded = await encodeMessage(msg);
	const decoded = await decodeMessage(encoded, Subscribe.Subscribe.decodeMessage);

	assert.strictEqual(decoded.subscribeId, 1n);
	assert.strictEqual(decoded.trackAlias, 2n);
	assert.strictEqual(decoded.trackNamespace, "test");
	assert.strictEqual(decoded.trackName, "video");
	assert.strictEqual(decoded.subscriberPriority, 128);
});

test("Subscribe: nested namespace", async () => {
	const msg = new Subscribe.Subscribe(100n, 200n, Path.from("conference/room123"), "audio", 255);

	const encoded = await encodeMessage(msg);
	const decoded = await decodeMessage(encoded, Subscribe.Subscribe.decodeMessage);

	assert.strictEqual(decoded.trackNamespace, "conference/room123");
});

test("SubscribeOk: with largest", async () => {
	const msg = new Subscribe.SubscribeOk(42n, [10n, 20n]);

	const encoded = await encodeMessage(msg);
	const decoded = await decodeMessage(encoded, Subscribe.SubscribeOk.decodeMessage);

	assert.strictEqual(decoded.subscribeId, 42n);
	assert.deepStrictEqual(decoded.largest, [10n, 20n]);
});

test("SubscribeOk: without largest", async () => {
	const msg = new Subscribe.SubscribeOk(42n);

	const encoded = await encodeMessage(msg);
	const decoded = await decodeMessage(encoded, Subscribe.SubscribeOk.decodeMessage);

	assert.strictEqual(decoded.subscribeId, 42n);
	assert.strictEqual(decoded.largest, undefined);
});

test("SubscribeError: round trip", async () => {
	const msg = new Subscribe.SubscribeError(123n, 500, "Not found", 456n);

	const encoded = await encodeMessage(msg);
	const decoded = await decodeMessage(encoded, Subscribe.SubscribeError.decodeMessage);

	assert.strictEqual(decoded.subscribeId, 123n);
	assert.strictEqual(decoded.errorCode, 500);
	assert.strictEqual(decoded.reasonPhrase, "Not found");
	assert.strictEqual(decoded.trackAlias, 456n);
});

test("Unsubscribe: round trip", async () => {
	const msg = new Subscribe.Unsubscribe(999n);

	const encoded = await encodeMessage(msg);
	const decoded = await decodeMessage(encoded, Subscribe.Unsubscribe.decodeMessage);

	assert.strictEqual(decoded.subscribeId, 999n);
});

test("SubscribeDone: with final", async () => {
	const msg = new Subscribe.SubscribeDone(10n, 0, "complete", [5n, 10n]);

	const encoded = await encodeMessage(msg);
	const decoded = await decodeMessage(encoded, Subscribe.SubscribeDone.decodeMessage);

	assert.strictEqual(decoded.subscribeId, 10n);
	assert.strictEqual(decoded.statusCode, 0);
	assert.strictEqual(decoded.reasonPhrase, "complete");
	assert.deepStrictEqual(decoded.final, [5n, 10n]);
});

test("SubscribeDone: without final", async () => {
	const msg = new Subscribe.SubscribeDone(10n, 1, "error");

	const encoded = await encodeMessage(msg);
	const decoded = await decodeMessage(encoded, Subscribe.SubscribeDone.decodeMessage);

	assert.strictEqual(decoded.subscribeId, 10n);
	assert.strictEqual(decoded.statusCode, 1);
	assert.strictEqual(decoded.reasonPhrase, "error");
	assert.strictEqual(decoded.final, undefined);
});

// Announce tests
test("Announce: round trip", async () => {
	const msg = new Announce.Announce(Path.from("test/broadcast"));

	const encoded = await encodeMessage(msg);
	const decoded = await decodeMessage(encoded, Announce.Announce.decodeMessage);

	assert.strictEqual(decoded.trackNamespace, "test/broadcast");
});

test("AnnounceOk: round trip", async () => {
	const msg = new Announce.AnnounceOk(Path.from("foo"));

	const encoded = await encodeMessage(msg);
	const decoded = await decodeMessage(encoded, Announce.AnnounceOk.decodeMessage);

	assert.strictEqual(decoded.trackNamespace, "foo");
});

test("AnnounceError: round trip", async () => {
	const msg = new Announce.AnnounceError(Path.from("test"), 404, "Unauthorized");

	const encoded = await encodeMessage(msg);
	const decoded = await decodeMessage(encoded, Announce.AnnounceError.decodeMessage);

	assert.strictEqual(decoded.trackNamespace, "test");
	assert.strictEqual(decoded.errorCode, 404);
	assert.strictEqual(decoded.reasonPhrase, "Unauthorized");
});

test("Unannounce: round trip", async () => {
	const msg = new Announce.Unannounce(Path.from("old/stream"));

	const encoded = await encodeMessage(msg);
	const decoded = await decodeMessage(encoded, Announce.Unannounce.decodeMessage);

	assert.strictEqual(decoded.trackNamespace, "old/stream");
});

test("AnnounceCancel: round trip", async () => {
	const msg = new Announce.AnnounceCancel(Path.from("canceled"), 1, "Shutdown");

	const encoded = await encodeMessage(msg);
	const decoded = await decodeMessage(encoded, Announce.AnnounceCancel.decodeMessage);

	assert.strictEqual(decoded.trackNamespace, "canceled");
	assert.strictEqual(decoded.errorCode, 1);
	assert.strictEqual(decoded.reasonPhrase, "Shutdown");
});

// GoAway tests
test("GoAway: with URL", async () => {
	const msg = new GoAway.GoAway("https://example.com/new");

	const encoded = await encodeMessage(msg);
	const decoded = await decodeMessage(encoded, GoAway.GoAway.decodeMessage);

	assert.strictEqual(decoded.newSessionUri, "https://example.com/new");
});

test("GoAway: empty", async () => {
	const msg = new GoAway.GoAway("");

	const encoded = await encodeMessage(msg);
	const decoded = await decodeMessage(encoded, GoAway.GoAway.decodeMessage);

	assert.strictEqual(decoded.newSessionUri, "");
});

// Track tests
test("TrackStatusRequest: round trip", async () => {
	const msg = new Track.TrackStatusRequest(Path.from("video/stream"), "main");

	const encoded = await encodeMessage(msg);
	const decoded = await decodeMessage(encoded, Track.TrackStatusRequest.decodeMessage);

	assert.strictEqual(decoded.trackNamespace, "video/stream");
	assert.strictEqual(decoded.trackName, "main");
});

test("TrackStatus: round trip", async () => {
	const msg = new Track.TrackStatus(Path.from("test"), "status", 200, 42n, 100n);

	const encoded = await encodeMessage(msg);
	const decoded = await decodeMessage(encoded, Track.TrackStatus.decodeMessage);

	assert.strictEqual(decoded.trackNamespace, "test");
	assert.strictEqual(decoded.trackName, "status");
	assert.strictEqual(decoded.statusCode, 200);
	assert.strictEqual(decoded.lastGroupId, 42n);
	assert.strictEqual(decoded.lastObjectId, 100n);
});

// Validation tests
test("Subscribe: rejects invalid filter type", async () => {
	const invalidBytes = new Uint8Array([
		0x01, // subscribe_id
		0x02, // track_alias
		0x01, // namespace length
		0x04,
		0x74,
		0x65,
		0x73,
		0x74, // "test"
		0x05,
		0x76,
		0x69,
		0x64,
		0x65,
		0x6f, // "video"
		0x80, // subscriber_priority
		0x02, // group_order
		0x99, // INVALID filter_type
		0x00, // num_params
	]);

	await assert.rejects(async () => {
		await decodeMessage(invalidBytes, Subscribe.Subscribe.decodeMessage);
	});
});

test("SubscribeOk: rejects non-zero expires", async () => {
	const invalidBytes = new Uint8Array([
		0x01, // subscribe_id
		0x05, // INVALID: expires = 5
		0x02, // group_order
		0x00, // content_exists
		0x00, // num_params
	]);

	await assert.rejects(async () => {
		await decodeMessage(invalidBytes, Subscribe.SubscribeOk.decodeMessage);
	});
});

// Unicode tests
test("SubscribeError: unicode strings", async () => {
	const msg = new Subscribe.SubscribeError(1n, 400, "Error: 错误 🚫", 2n);

	const encoded = await encodeMessage(msg);
	const decoded = await decodeMessage(encoded, Subscribe.SubscribeError.decodeMessage);

	assert.strictEqual(decoded.reasonPhrase, "Error: 错误 🚫");
});

test("Announce: unicode namespace", async () => {
	const msg = new Announce.Announce(Path.from("会议/房间"));

	const encoded = await encodeMessage(msg);
	const decoded = await decodeMessage(encoded, Announce.Announce.decodeMessage);

	assert.strictEqual(decoded.trackNamespace, "会议/房间");
});
