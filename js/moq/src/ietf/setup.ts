import type { Reader, Writer } from "../stream.ts";
import * as Message from "./message.ts";

const MAX_VERSIONS = 128;

export class Role {
	static id = 0x00;
	role: "publisher" | "subscriber" | "both";

	constructor(role: "publisher" | "subscriber" | "both") {
		this.role = role;
	}

	async #encode(w: Writer): Promise<void> {
		const value = this.role === "publisher" ? 0x01 : this.role === "subscriber" ? 0x02 : 0x03;
		await w.u53(value);
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<Role> {
		return Message.decode(r, Role.#decode);
	}

	static async #decode(r: Reader): Promise<Role> {
		const value = await r.u53();
		switch (value) {
			case 0x01:
				return new Role("publisher");
			case 0x02:
				return new Role("subscriber");
			case 0x03:
				return new Role("both");
			default:
				throw new Error(`invalid role: ${value}`);
		}
	}
}

export class Path {
	static id = 0x01;

	path: string;

	constructor(path: string) {
		this.path = path;
	}

	async #encode(w: Writer): Promise<void> {
		await w.string(this.path);
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<Path> {
		return Message.decode(r, Path.#decode);
	}

	static async #decode(r: Reader): Promise<Path> {
		const path = await r.string();
		return new Path(path);
	}
}

export class MaxSubscribeId {
	static id = 0x02;

	maxSubscribeId: number;

	constructor(maxSubscribeId: number) {
		this.maxSubscribeId = maxSubscribeId;
	}

	async #encode(w: Writer): Promise<void> {
		await w.u53(this.maxSubscribeId);
	}

	async encode(w: Writer): Promise<void> {
		return Message.encode(w, this.#encode.bind(this));
	}

	static async decode(r: Reader): Promise<MaxSubscribeId> {
		return Message.decode(r, MaxSubscribeId.#decode);
	}

	static async #decode(r: Reader): Promise<MaxSubscribeId> {
		const maxSubscribeId = await r.u53();
		return new MaxSubscribeId(maxSubscribeId);
	}
}

const Parameters = {
	[Role.id]: Role,
	[Path.id]: Path,
	[MaxSubscribeId.id]: MaxSubscribeId,
} as const;

export type ParameterId = keyof typeof Parameters;

export type ParameterType = (typeof Parameters)[keyof typeof Parameters];

// Type for control message instances (not constructors)
export type Parameter = InstanceType<ParameterType>;

export class ClientSetup {
	static id = 0x20;

	versions: number[];
	parameters: Parameter[];

	constructor(versions: number[], ...parameters: Parameter[]) {
		this.versions = versions;
		this.parameters = parameters;
	}

	async #encode(w: Writer): Promise<void> {
		await w.u53(this.versions.length);
		for (const v of this.versions) {
			await w.u53(v);
		}

		// Number of parameters
		await w.u53(this.parameters.length);

		// Parameters
		for (const parameter of this.parameters) {
			await w.u53((parameter.constructor as ParameterType).id);
			await parameter.encode(w);
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
		const parameters: Parameter[] = [];

		for (let i = 0; i < numParams; i++) {
			const key = await r.u53();
			const f = Parameters[key];
			if (!f) {
				throw new Error(`unknown parameter: ${key}`);
			}
			parameters.push(await f.decode(r));
		}

		return new ClientSetup(supportedVersions, ...parameters);
	}

	static async decode(r: Reader): Promise<ClientSetup> {
		return Message.decode(r, ClientSetup.#decode);
	}
}

export class ServerSetup {
	static id = 0x21;

	version: number;
	parameters: Parameter[];

	constructor(version: number, ...parameters: Parameter[]) {
		this.version = version;
		this.parameters = parameters;
	}

	async #encode(w: Writer): Promise<void> {
		await w.u53(this.version);

		// Number of parameters
		await w.u53(this.parameters.length);

		// Parameters
		for (const parameter of this.parameters) {
			await w.u53((parameter.constructor as ParameterType).id);
			await parameter.encode(w);
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
		const parameters: Parameter[] = [];

		for (let i = 0; i < numParams; i++) {
			// Read message type
			const parameterType = await r.u53();
			if (!(parameterType in Parameters)) {
				throw new Error(`Unknown parameter type: ${parameterType}`);
			}

			const parameter = await Parameters[parameterType].decode(r);
			parameters.push(parameter);
		}

		return new ServerSetup(selectedVersion, ...parameters);
	}

	static async decode(r: Reader): Promise<ServerSetup> {
		return Message.decode(r, ServerSetup.#decode);
	}
}
