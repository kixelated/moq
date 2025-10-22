import type { Reader, Writer } from "../stream";

export class Parameters {
	entries: Map<bigint, Uint8Array>;

	constructor() {
		this.entries = new Map();
	}

	get size() {
		return this.entries.size;
	}

	set(id: bigint, value: Uint8Array) {
		this.entries.set(id, value);
	}

	get(id: bigint): Uint8Array | undefined {
		return this.entries.get(id);
	}

	remove(id: bigint): Uint8Array | undefined {
		const value = this.entries.get(id);
		this.entries.delete(id);
		return value;
	}

	async encode(w: Writer) {
		await w.u53(this.entries.size);
		for (const [id, value] of this.entries) {
			await w.u62(id);
			await w.u53(value.length);
			await w.write(value);
		}
	}

	static async decode(r: Reader): Promise<Parameters> {
		const count = await r.u53();
		const params = new Parameters();

		for (let i = 0; i < count; i++) {
			const id = await r.u62();
			const size = await r.u53();
			const value = await r.read(size);

			if (params.entries.has(id)) {
				throw new Error(`duplicate parameter id: ${id.toString()}`);
			}

			params.entries.set(id, value);
		}

		return params;
	}
}
