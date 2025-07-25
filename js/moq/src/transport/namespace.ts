import * as Path from "../path";
import type { Reader, Writer } from "../stream";

export async function encode(w: Writer, namespace: Path.Valid): Promise<void> {
	const parts = namespace.split("/");
	await w.u53(parts.length);
	for (const part of parts) {
		await w.string(part);
	}
}


export async function decode(r: Reader): Promise<Path.Valid> {
	const parts: string[] = [];
	const count = await r.u53();
	for (let i = 0; i < count; i++) {
		parts.push(await r.string());
	}
	return Path.from(...parts);
}
