export const TRACKS = {
	catalog: "catalog.json",
	audio: {
		data: "audio/data",
		captions: "audio/captions.txt",
		speaking: "audio/speaking.bool",
	},
	chat: {
		message: "chat/message.txt",
		typing: "chat/typing.bool",
	},
	video: {
		data: "video/data",
		detection: "video/detection.json",
	},
	location: {
		window: "location/window.json",
		peers: "location/peers.json",
	},
	preview: "preview.json",
} as const;
