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

		await this.parameters.encode(w);
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

		const parameters = await Parameters.decode(r);

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
		await this.parameters.encode(w);
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async #decode(r: Reader): Promise<ServerSetup> {
		// Selected version
		const selectedVersion = await r.u53();
		const parameters = await Parameters.decode(r);

		return new ServerSetup(selectedVersion, parameters);
	}

	static async decode(r: Reader): Promise<ServerSetup> {
		return Message.decode(r, ServerSetup.#decode);
	}
}
