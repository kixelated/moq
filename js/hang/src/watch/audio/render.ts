import type * as Time from "../../time";

export type Message = Init | Data;

export interface Data {
	type: "data";
	data: Float32Array[];
	timestamp: Time.Micro;
}

export interface Init {
	type: "init";
	sampleRate: number;
	channelCount: number;
	latency: Time.Micro;
}
