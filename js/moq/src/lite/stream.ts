import type { AnnounceInterest } from "./announce";
import type { Group } from "./group";
import type { SessionClient } from "./session";
import type { Subscribe } from "./subscribe";

export type StreamBi = SessionClient | AnnounceInterest | Subscribe;
export type StreamUni = Group;
