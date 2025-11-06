import type { Reader, Writer } from "../stream";

export class Location {
	group: bigint;
	object: bigint;

	constructor(group: bigint, object: bigint) {
		this.group = group;
		this.object = object;
	}

	async encode(w: Writer): Promise<void> {
		await w.u62(this.group);
		await w.u62(this.object);
	}

	static async decode(r: Reader): Promise<Location> {
		const group = await r.u62();
		const object = await r.u62();
		return new Location(group, object);
	}
}
