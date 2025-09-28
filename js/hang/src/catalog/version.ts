import semver from "semver";
import { z } from "zod";

export const VersionSchema = z
	.string()
	.refine((val) => semver.valid(val) !== null, {
		message: "Invalid semantic version",
	})
	.refine((val) => semver.satisfies(val, SUPPORTED), {
		message: "Unsupported version",
	});

export type Version = z.infer<typeof VersionSchema>;

export const VERSION: Version = "0.1.0";
const SUPPORTED = "0.1";
