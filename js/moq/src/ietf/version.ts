/**
 * Supported MoQ Transport protocol versions
 */
export const Version = {
	/**
	 * draft-ietf-moq-transport-07
	 * https://www.ietf.org/archive/id/draft-ietf-moq-transport-07.txt
	 */
	DRAFT_07: 0xff000007,

	/**
	 * draft-ietf-moq-transport-14
	 * https://www.ietf.org/archive/id/draft-ietf-moq-transport-14.txt
	 */
	DRAFT_14: 0xff00000e,
} as const;

export type Version = (typeof Version)[keyof typeof Version];

/**
 * The current/default version used by this implementation
 */
export const CURRENT_VERSION = Version.DRAFT_14;
