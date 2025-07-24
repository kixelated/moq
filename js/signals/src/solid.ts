import { createSignal, type Accessor as SolidAccessor } from "solid-js";
import type { Getter } from "./index";

// A helper to create a solid-js signal.
export default function solid<T>(signal: Getter<T>): SolidAccessor<T> {
	const [get, set] = createSignal(signal.peek());
	signal.subscribe((value) => set(() => value));
	return get;
}
