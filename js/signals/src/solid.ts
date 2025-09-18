import { createSignal, type Accessor as SolidAccessor } from "solid-js";
import type { Getter } from "./index";

// A helper to create a solid-js signal.
export default function solid<T>(signal: Getter<T>): SolidAccessor<T> {
	// Disable the equals check because we do it ourselves.
	const [get, set] = createSignal(signal.peek(), { equals: false });
	signal.subscribe((value) => set(() => value));
	return get;
}
