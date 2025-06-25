import { type Accessor, createSignal } from "solid-js";
import type { Computed, Signal } from "./index";

// A helper to create a solid-js signal.
export default function solid<T>(signal: Signal<T> | Computed<T>): Accessor<T> {
	const [get, set] = createSignal(signal.peek());
	signal.subscribe((value) => set(() => value));
	return get;
}
