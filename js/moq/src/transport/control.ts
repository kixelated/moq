import type { Reader, Writer } from "../stream";
import { Announce, AnnounceCancel, AnnounceError, AnnounceOk, Unannounce } from "./announce";
import { GoAway } from "./goaway";
import * as Setup from "./setup";
import { Subscribe, SubscribeDone, SubscribeError, SubscribeOk, Unsubscribe } from "./subscribe";
import { TrackStatus, TrackStatusRequest } from "./track";

/**
 * Control message types as defined in moq-transport-07
 */
const Messages = {
	[Setup.Client.id]: Setup.Client,
	[Setup.Server.id]: Setup.Server,
	[Subscribe.id]: Subscribe,
	[SubscribeOk.id]: SubscribeOk,
	[SubscribeError.id]: SubscribeError,
	[Announce.id]: Announce,
	[AnnounceOk.id]: AnnounceOk,
	[AnnounceError.id]: AnnounceError,
	[Unannounce.id]: Unannounce,
	[Unsubscribe.id]: Unsubscribe,
	[SubscribeDone.id]: SubscribeDone,
	[AnnounceCancel.id]: AnnounceCancel,
	[TrackStatusRequest.id]: TrackStatusRequest,
	[TrackStatus.id]: TrackStatus,
	[GoAway.id]: GoAway,
} as const;

export type MessageId = keyof typeof Messages;

export type MessageType = (typeof Messages)[keyof typeof Messages];

// Type for control message instances (not constructors)
export type Message = InstanceType<MessageType>;

/**
 * Writes a control message to the control stream with proper framing.
 * Format: Message Type (varint) + Message Length (varint) + Message Payload
 */
export async function write<T extends Message>(writer: Writer, message: T): Promise<void> {
	// Write message type
	await writer.u53((message.constructor as MessageType).id);

	// Write message payload
	await writer.message(message.encodeMessage.bind(message));
}

/**
 * Reads a control message from the control stream.
 * Returns the message type and a reader for the payload.
 */
export async function read(reader: Reader): Promise<Message> {
	// Read message type
	const messageType = await reader.u53();
	if (!(messageType in Messages)) {
		throw new Error(`Unknown control message type: ${messageType}`);
	}

	const f: (r: Reader) => Promise<Message> = Messages[messageType].decodeMessage;
	return reader.message(f);
}
