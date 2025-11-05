import type { Reader, Writer } from "../stream.ts";
import type { GroupFlags } from "./group.ts";

const GROUP_END = 0x03;

export class Frame {
	// undefined means end of group
	payload?: Uint8Array;

	constructor(payload?: Uint8Array) {
		this.payload = payload;
	}

	async encode(w: Writer, flags: GroupFlags): Promise<void> {
		await w.u53(0); // id_delta = 0

		if (flags.hasExtensions) {
			await w.u53(0); // extensions length = 0
		}

		if (this.payload !== undefined) {
			await w.u53(this.payload.byteLength);

			if (this.payload.byteLength === 0) {
				await w.u53(0); // status = normal
			} else {
				await w.write(this.payload);
			}
		} else {
			await w.u53(0); // length = 0
			await w.u53(GROUP_END);
		}
	}

	static async decode(r: Reader, flags: GroupFlags): Promise<Frame> {
		console.debug("reading frame delta");
		const delta = await r.u53();
		console.debug("read frame delta", delta);
		if (delta !== 0) {
			console.warn(`object ID delta is not supported, ignoring: ${delta}`);
		}

		if (flags.hasExtensions) {
			const extensionsLength = await r.u53();
			// We don't care about extensions
			await r.read(extensionsLength);
		}

		const payloadLength = await r.u53();

		if (payloadLength > 0) {
			const payload = await r.read(payloadLength);
			return new Frame(payload);
		}

		const status = await r.u53();

		if (flags.hasEnd) {
			// Empty frame
			if (status === 0) return new Frame(new Uint8Array(0));
		} else if (status === 0 || status === GROUP_END) {
			// TODO status === 0 should be an empty frame, but moq-rs seems to be sending it incorrectly on group end.
			return new Frame();
		}

		throw new Error(`Unsupported object status: ${status}`);
	}
}
