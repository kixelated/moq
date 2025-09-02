import type * as Time from "../../time";

export interface AudioFrame {
	timestamp: Time.Micro;
	channels: Float32Array[];
}
