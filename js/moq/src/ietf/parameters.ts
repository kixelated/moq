import type { Reader, Writer } from "../stream";
import { setVint62 } from "../stream";

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
			// Per draft-ietf-moq-transport-14 Section 1.4.2:
			// - If Type is even, Value is a single varint (no length prefix)
			// - If Type is odd, Value has a length prefix followed by bytes
			if (id % 2n === 0n) {
				// Even: value is stored as encoded varint bytes, write them directly
				await w.write(value);
			} else {
				// Odd: encode as length-prefixed bytes
				await w.u53(value.length);
				await w.write(value);
			}
		}
	}

	static async decode(r: Reader): Promise<Parameters> {
		const count = await r.u53();
		const params = new Parameters();

		for (let i = 0; i < count; i++) {
			const id = await r.u62();

			// Per draft-ietf-moq-transport-14 Section 1.4.2:
			// - If Type is even, Value is a single varint (no length prefix)
			// - If Type is odd, Value has a length prefix followed by bytes
			let value: Uint8Array;
			if (id % 2n === 0n) {
				// Even: read varint and store as encoded bytes
				const varintValue = await r.u62();
				// Encode the varint back to bytes to store it
				const temp = new Uint8Array(8);
				const encoded = setVint62(temp.buffer, varintValue);
				value = encoded;
			} else {
				// Odd: read length-prefixed bytes
				const size = await r.u53();
				value = await r.read(size);
			}

			if (params.entries.has(id)) {
				throw new Error(`duplicate parameter id: ${id.toString()}`);
			}

			params.entries.set(id, value);
		}

		return params;
	}
}
