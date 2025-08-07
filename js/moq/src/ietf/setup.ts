import type { Reader, Writer } from "../stream";

export const CURRENT_VERSION = 0xff000007;
const MAX_VERSIONS = 128;

export class Role {
	static id = 0x00;
	role: "publisher" | "subscriber" | "both";

	constructor(role: "publisher" | "subscriber" | "both") {
		this.role = role;
	}

	async encodeMessage(w: Writer): Promise<void> {
		const value = this.role === "publisher" ? 0x01 : this.role === "subscriber" ? 0x02 : 0x03;
		await w.u53(value);
	}

	static async decodeMessage(r: Reader): Promise<Role> {
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

	async encodeMessage(w: Writer): Promise<void> {
		await w.string(this.path);
	}

	static async decodeMessage(r: Reader): Promise<Path> {
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

	async encodeMessage(w: Writer): Promise<void> {
		await w.u53(this.maxSubscribeId);
	}

	static async decodeMessage(r: Reader): Promise<MaxSubscribeId> {
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

export class Client {
	static id = 0x40;

	parameters: Parameter[];

	constructor(...parameters: Parameter[]) {
		this.parameters = parameters;
	}

	async encodeMessage(w: Writer): Promise<void> {
		await w.u8(0x01); // 1 support version
		await w.u53(CURRENT_VERSION);

		// Number of parameters
		await w.u53(this.parameters.length);

		// Parameters
		for (const parameter of this.parameters) {
			await w.u53((parameter.constructor as ParameterType).id);
			await w.message(parameter.encodeMessage.bind(parameter));
		}
	}

	static async decodeMessage(r: Reader): Promise<Client> {
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

		if (!supportedVersions.some((v) => v === CURRENT_VERSION)) {
			throw new Error(`unsupported versions: ${supportedVersions.join(", ")}`);
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
			parameters.push(await f.decodeMessage(r));
		}

		return new Client(...parameters);
	}
}

export class Server {
	static id = 0x41;

	parameters: Parameter[];

	constructor(...parameters: Parameter[]) {
		this.parameters = parameters;
	}

	async encodeMessage(w: Writer): Promise<void> {
		// Selected version
		await w.u53(CURRENT_VERSION);

		// Number of parameters
		await w.u53(this.parameters.length);

		// Parameters
		for (const parameter of this.parameters) {
			await w.u53((parameter.constructor as ParameterType).id);
			await w.message(parameter.encodeMessage.bind(parameter));
		}
	}

	static async decodeMessage(r: Reader): Promise<Server> {
		// Selected version
		const selectedVersion = await r.u53();
		if (selectedVersion !== CURRENT_VERSION) {
			throw new Error(`unsupported server version: ${selectedVersion.toString(16)}`);
		}

		// Number of parameters
		const numParams = await r.u53();
		const parameters: Parameter[] = [];

		for (let i = 0; i < numParams; i++) {
			// Read message type
			const parameterType = await r.u53();
			if (!(parameterType in Parameters)) {
				throw new Error(`Unknown parameter type: ${parameterType}`);
			}

			const f: (r: Reader) => Promise<Parameter> = Parameters[parameterType].decodeMessage;
			const parameter = await r.message(f);
			parameters.push(parameter);
		}

		return new Server(...parameters);
	}
}
