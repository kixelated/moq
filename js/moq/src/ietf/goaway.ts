import type { Reader, Writer } from "../stream.ts";

export class GoAway {
	static id = 0x10;

	newSessionUri: string;

	constructor(newSessionUri: string) {
		this.newSessionUri = newSessionUri;
	}

	async encodeMessage(w: Writer): Promise<void> {
		await w.string(this.newSessionUri);
	}

	static async decodeMessage(r: Reader): Promise<GoAway> {
		const newSessionUri = await r.string();
		return new GoAway(newSessionUri);
	}
}
