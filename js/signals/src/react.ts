import { useSyncExternalStore } from "react";
import type { Getter } from "./index";

// A helper to create a React signal.
export default function react<T>(signal: Getter<T>): T {
	return useSyncExternalStore(
		(callback) => signal.subscribe(callback),
		() => signal.peek(),
		() => signal.peek(),
	);
}
