export const Version = {
	DRAFT_01: 0xff0dad01,
	DRAFT_02: 0xff0dad02,
	DRAFT_03: 0xff0dad03,
} as const;

export type Version = (typeof Version)[keyof typeof Version];

export const SUPPORTED: Version[] = [Version.DRAFT_03, Version.DRAFT_02, Version.DRAFT_01];
