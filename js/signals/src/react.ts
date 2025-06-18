import { useSyncExternalStore } from "react";
import { Computed, Signal } from "./index";

// A helper to create a React signal.
export default function react<T>(signal: Signal<T> | Computed<T>): T {
	return useSyncExternalStore(
		(callback) => signal.subscribe(callback),
		() => signal.peek(),
		() => signal.peek(),
	);
}
