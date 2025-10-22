import type { Reader, Writer } from "../stream.ts";
import * as Message from "./message.ts";
import { Parameters } from "./parameters.ts";

const MAX_VERSIONS = 128;

export class ClientSetup {
	static id = 0x20;

	versions: number[];
	parameters: Parameters;

	constructor(versions: number[], parameters = new Parameters()) {
		this.versions = versions;
		this.parameters = parameters;
	}

	async #encode(w: Writer): Promise<void> {
		await w.u53(this.versions.length);
		for (const v of this.versions) {
			await w.u53(v);
		}

		// Number of parameters
		await w.u53(this.parameters.size);

		// Parameters
		for (const [id, data] of this.parameters.entries) {
			await w.u62(id);
			await w.u53(data.length);
			await w.write(data);
		}
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async #decode(r: Reader): Promise<ClientSetup> {
		// Number of supported versions
		const numVersions = await r.u53();
		if (numVersions > MAX_VERSIONS) {
			throw new Error(`too many versions: ${numVersions}`);
		}

		const supportedVersions: number[] = [];

		for (let i = 0; i < numVersions; i++) {
			const version = await r.u53();
			supportedVersions.push(version);
		}

		// Number of parameters
		const numParams = await r.u53();
		const parameters = new Parameters();

		for (let i = 0; i < numParams; i++) {
			const id = await r.u62();
			const size = await r.u53();
			const value = await r.read(size);
			parameters.set(id, value);
		}

		return new ClientSetup(supportedVersions, parameters);
	}

	static async decode(r: Reader): Promise<ClientSetup> {
		return Message.decode(r, ClientSetup.#decode);
	}
}

export class ServerSetup {
	static id = 0x21;

	version: number;
	parameters: Parameters;

	constructor(version: number, parameters = new Parameters()) {
		this.version = version;
		this.parameters = parameters;
	}

	async #encode(w: Writer): Promise<void> {
		await w.u53(this.version);

		// Number of parameters
		await w.u53(this.parameters.size);

		// Parameters
		for (const [id, data] of this.parameters.entries) {
			await w.u62(id);
			await w.u53(data.length);
			await w.write(data);
		}
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async #decode(r: Reader): Promise<ServerSetup> {
		// Selected version
		const selectedVersion = await r.u53();

		// Number of parameters
		const numParams = await r.u53();
		const parameters = new Parameters();

		for (let i = 0; i < numParams; i++) {
			// Read message type
			const id = await r.u62();
			const size = await r.u53();
			const value = await r.read(size);
			parameters.set(id, value);
		}

		return new ServerSetup(selectedVersion, parameters);
	}

	static async decode(r: Reader): Promise<ServerSetup> {
		return Message.decode(r, ServerSetup.#decode);
	}
}
