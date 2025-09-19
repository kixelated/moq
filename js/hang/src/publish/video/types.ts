export type Source = VideoStreamTrack;

// Stronger typing for the MediaStreamTrack interface.
export interface VideoStreamTrack extends MediaStreamTrack {
	kind: "video";
	clone(): VideoStreamTrack;
	getSettings(): VideoTrackSettings;
}

export interface VideoTrackSettings {
	deviceId: string;
	groupId: string;

	// I'm not sure what fields are always present.
	aspectRatio: number;
	facingMode: "user" | "environment" | "left" | "right";
	frameRate?: number;
	height: number;
	resizeMode: "none" | "crop-and-scale";
	width: number;
}

export type VideoConstraints = Omit<
	MediaTrackConstraints,
	"autoGainControl" | "channelCount" | "echoCancellation" | "noiseSuppression" | "sampleRate" | "sampleSize"
> & {
	// TODO update @types/web
	resizeMode?: "none" | "crop-and-scale";
};
