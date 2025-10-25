import type { Reader, Writer } from "../stream.ts";
import * as Message from "./message.ts";

export class GoAway {
	static id = 0x10;

	newSessionUri: string;

	constructor(newSessionUri: string) {
		this.newSessionUri = newSessionUri;
	}

	async #encode(w: Writer): Promise<void> {
		await w.string(this.newSessionUri);
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<GoAway> {
		return Message.decode(r, GoAway.#decode);
	}

	static async #decode(r: Reader): Promise<GoAway> {
		const newSessionUri = await r.string();
		return new GoAway(newSessionUri);
	}
}
