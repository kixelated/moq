import { Signal } from "@moq/signals";

/**
 * Stub settings module for the live/room system.
 * This provides default values for all settings used by the live module.
 *
 * Types match the original settings.tsx from hang/app but without localStorage persistence.
 * In a real application, these would be persisted to localStorage or similar,
 * and likely have UI controls to modify them.
 */

export const Settings = {
	// Draggable/remote control
	draggable: new Signal<boolean>(true),

	// Audio settings
	audio: {
		enabled: new Signal<boolean>(true),
		volume: new Signal<number>(1.0),
		tts: new Signal<"none" | "low" | "high">("none"),
	},

	// Microphone settings
	microphone: {
		enabled: new Signal<boolean>(false),
		gain: new Signal<number>(1.0),
		device: new Signal<string | undefined>(undefined),
	},

	// Camera settings
	camera: {
		enabled: new Signal<boolean>(false),
		device: new Signal<string | undefined>(undefined),
	},

	// Account settings
	account: {
		guest: new Signal<string | undefined>(undefined),
		name: new Signal<string | undefined>(undefined),
		avatar: new Signal<string | undefined>(undefined),
	},

	// OAuth settings
	oauth: {
		token: new Signal<string | undefined>(undefined),
		random: new Signal<string | undefined>(undefined),
	},

	// Tutorial settings
	tutorial: {
		step: new Signal<number>(0),
	},

	// Rendering settings
	render: {
		scale: new Signal<number>(1.0), // Device pixel ratio multiplier
	},

	// Debug settings
	debug: {
		tracks: new Signal<boolean>(false),
	},
};

export default Settings;
