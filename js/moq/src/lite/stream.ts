import type { AnnounceInterest } from "./announce";
import type { Group } from "./group";
import type { SessionClient } from "./session";
import type { Subscribe } from "./subscribe";

export type StreamBi = SessionClient | AnnounceInterest | Subscribe;
export type StreamUni = Group;

export const SteamId = {
	Session: 0,
	Announce: 1,
	Subscribe: 2,
	ClientCompat: 0x40,
	ServerCompat: 0x41,
} as const;
