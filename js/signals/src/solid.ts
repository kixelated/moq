import { createSignal, type Accessor as SolidAccessor } from "solid-js";
import type { Accessor } from "./index";

// A helper to create a solid-js signal.
export default function solid<T>(signal: Accessor<T>): SolidAccessor<T> {
	const [get, set] = createSignal(signal.peek());
	signal.subscribe((value) => set(() => value));
	return get;
}
