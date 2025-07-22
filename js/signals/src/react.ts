import { useSyncExternalStore } from "react";
import type { Accessor } from "./index";

// A helper to create a React signal.
export default function react<T>(signal: Accessor<T>): T {
	return useSyncExternalStore(
		(callback) => signal.subscribe(callback),
		() => signal.peek(),
		() => signal.peek(),
	);
}
