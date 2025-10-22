import type { Reader, Writer } from "../stream.ts";
import * as Message from "./message.ts";

// PUBLISH messages are new in draft-14 but not yet fully supported
// These are stubs matching the Rust implementation

export class Publish {
	static id = 0x1d;

	async #encode(_w: Writer): Promise<void> {
		throw new Error("PUBLISH messages are not supported");
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<Publish> {
		return Message.decode(r, Publish.#decode);
	}

	static async #decode(_r: Reader): Promise<Publish> {
		throw new Error("PUBLISH messages are not supported");
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

	async #encode(_w: Writer): Promise<void> {
		throw new Error("PUBLISH_ERROR messages are not supported");
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<PublishError> {
		return Message.decode(r, PublishError.#decode);
	}

	static async #decode(_r: Reader): Promise<PublishError> {
		throw new Error("PUBLISH_ERROR messages are not supported");
	}
}
