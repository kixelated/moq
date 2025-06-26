export interface AudioFrame {
	timestamp: number;
	channels: Float32Array[];
}

export type Message = Init | Data;

export interface Data {
	type: "data";
	data: Float32Array[];
	timestamp: number;
}

export interface Init {
	type: "init";
	sampleRate: number;
	channelCount: number;
	latency: DOMHighResTimeStamp;
}

export interface Status {
	type: "status";
	available: number;
	utilization: number;
}
