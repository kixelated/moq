import type { Reader, Writer } from "../stream";
import * as Message from "./message";

export class ClientSetup implements Message.Encode {
	static StreamID = 0x40;

	supportedVersions: number[];
	parameters: Map<number, Uint8Array>;

	constructor(supportedVersions: number[], parameters: Map<number, Uint8Array> = new Map()) {
		this.supportedVersions = supportedVersions;
		this.parameters = parameters;
	}

	async encode(w: Writer): Promise<void> {
		await Message.encode(w, this, this.encodeBody);
	}

	async encodeBody(w: Writer): Promise<void> {
		// Number of supported versions
		await w.u53(this.supportedVersions.length);

		// Supported versions
		for (const version of this.supportedVersions) {
			await w.u53(version);
		}

		// Number of parameters
		await w.u53(this.parameters.size);

		// Parameters
		for (const [key, value] of this.parameters) {
			await w.u53(key);
			await w.u53(value.length);
			await w.write(value);
		}
	}

	static async decodeBody(r: Reader): Promise<ClientSetup> {
		// Number of supported versions
		const numVersions = await r.u53();
		const supportedVersions: number[] = [];

		for (let i = 0; i < numVersions; i++) {
			supportedVersions.push(await r.u53());
		}

		// Number of parameters
		const numParams = await r.u53();
		const parameters = new Map<number, Uint8Array>();

		for (let i = 0; i < numParams; i++) {
			const key = await r.u53();
			const length = await r.u53();
			const value = await r.read(length);
			parameters.set(key, value);
		}

		return new ClientSetup(supportedVersions, parameters);
	}
}

export class ServerSetup implements Message.Encode {
	static StreamID = 0x41;

	selectedVersion: number;
	parameters: Map<number, Uint8Array>;

	constructor(selectedVersion: number, parameters: Map<number, Uint8Array> = new Map()) {
		this.selectedVersion = selectedVersion;
		this.parameters = parameters;
	}

	async encode(w: Writer): Promise<void> {
		await Message.encode(w, this, this.encodeBody);
	}

	async encodeBody(w: Writer): Promise<void> {
		// Selected version
		await w.u53(this.selectedVersion);

		// Number of parameters
		await w.u53(this.parameters.size);

		// Parameters
		for (const [key, value] of this.parameters) {
			await w.u53(key);
			await w.u53(value.length);
			await w.write(value);
		}
	}

	static async decodeBody(r: Reader): Promise<ServerSetup> {
		// Selected version
		const selectedVersion = await r.u53();

		// Number of parameters
		const numParams = await r.u53();
		const parameters = new Map<number, Uint8Array>();

		for (let i = 0; i < numParams; i++) {
			const key = await r.u53();
			const length = await r.u53();
			const value = await r.read(length);
			parameters.set(key, value);
		}

		return new ServerSetup(selectedVersion, parameters);
	}

	// Standard parameter keys from the spec
	static readonly PARAM_ROLE = 0x00;
	static readonly PARAM_PATH = 0x01;
	static readonly PARAM_MAX_SUBSCRIBE_ID = 0x02;

	// Role values
	static readonly ROLE_PUBLISHER = 0x01;
	static readonly ROLE_SUBSCRIBER = 0x02;
	static readonly ROLE_PUBSUB = 0x03;
}
