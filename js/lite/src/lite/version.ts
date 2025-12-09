export const Version = {
	DRAFT_01: 0xff0dad01,
	DRAFT_02: 0xff0dad02,
} as const;

export type Version = (typeof Version)[keyof typeof Version];
