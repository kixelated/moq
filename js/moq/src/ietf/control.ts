import { Mutex } from "async-mutex";
import type { Stream as StreamInner } from "../stream.ts";
import {
	PublishNamespace,
	PublishNamespaceCancel,
	PublishNamespaceDone,
	PublishNamespaceError,
	PublishNamespaceOk,
} from "./announce.ts";
import { Fetch, FetchCancel, FetchError, FetchOk } from "./fetch.ts";
import { GoAway } from "./goaway.ts";
import { Publish, PublishError, PublishOk } from "./publish.ts";
import * as Setup from "./setup.ts";
import { PublishDone, Subscribe, SubscribeError, SubscribeOk, Unsubscribe } from "./subscribe.ts";
import {
	SubscribeNamespace,
	SubscribeNamespaceError,
	SubscribeNamespaceOk,
	UnsubscribeNamespace,
} from "./subscribe_announces.ts";
import { TrackStatus, TrackStatusRequest } from "./track.ts";

/**
 * Control message types as defined in moq-transport-14
 */
const Messages = {
	[Setup.ClientSetup.id]: Setup.ClientSetup,
	[Setup.ServerSetup.id]: Setup.ServerSetup,
	[Subscribe.id]: Subscribe,
	[SubscribeOk.id]: SubscribeOk,
	[SubscribeError.id]: SubscribeError,
	[PublishNamespace.id]: PublishNamespace,
	[PublishNamespaceOk.id]: PublishNamespaceOk,
	[PublishNamespaceError.id]: PublishNamespaceError,
	[PublishNamespaceDone.id]: PublishNamespaceDone,
	[Unsubscribe.id]: Unsubscribe,
	[PublishDone.id]: PublishDone,
	[PublishNamespaceCancel.id]: PublishNamespaceCancel,
	[TrackStatusRequest.id]: TrackStatusRequest,
	[TrackStatus.id]: TrackStatus,
	[GoAway.id]: GoAway,
	[Fetch.id]: Fetch,
	[FetchCancel.id]: FetchCancel,
	[FetchOk.id]: FetchOk,
	[FetchError.id]: FetchError,
	[SubscribeNamespace.id]: SubscribeNamespace,
	[SubscribeNamespaceOk.id]: SubscribeNamespaceOk,
	[SubscribeNamespaceError.id]: SubscribeNamespaceError,
	[UnsubscribeNamespace.id]: UnsubscribeNamespace,
	[Publish.id]: Publish,
	[PublishOk.id]: PublishOk,
	[PublishError.id]: PublishError,
} as const;

export type MessageId = keyof typeof Messages;

export type MessageType = (typeof Messages)[keyof typeof Messages];

// Type for control message instances (not constructors)
export type Message = InstanceType<MessageType>;

export class Stream {
	stream: StreamInner;

	#writeLock = new Mutex();
	#readLock = new Mutex();

	constructor(stream: StreamInner) {
		this.stream = stream;
	}

	/**
	 * Writes a control message to the control stream with proper framing.
	 * Format: Message Type (varint) + Message Length (u16) + Message Payload
	 */
	async write<T extends Message>(message: T): Promise<void> {
		console.debug("message write", message);

		await this.#writeLock.runExclusive(async () => {
			// Write message type
			await this.stream.writer.u53((message.constructor as MessageType).id);

			// Write message payload with u16 size prefix
			await message.encode(this.stream.writer);
		});
	}

	/**
	 * Reads a control message from the control stream.
	 * Returns the message type and a reader for the payload.
	 */
	async read(): Promise<Message> {
		return await this.#readLock.runExclusive(async () => {
			const messageType = await this.stream.reader.u53();
			if (!(messageType in Messages)) {
				throw new Error(`Unknown control message type: ${messageType}`);
			}

			try {
				const msg = await Messages[messageType].decode(this.stream.reader);
				console.debug("message read", msg);
				return msg;
			} catch (err) {
				console.error("failed to decode message", messageType, err);
				throw err;
			}
		});
	}
}
