import type { Announced } from "./announced.ts";
import type { Broadcast } from "./broadcast.ts";
import type * as Path from "./path.ts";

// Both moq-lite and moq-ietf implement this.
export interface Connection {
	readonly url: URL;

	announced(): Promise<Announced | undefined>;
	publish(name: Path.Valid, broadcast: Broadcast): void;
	consume(broadcast: Path.Valid): Broadcast;
	close(): void;
	closed: Promise<void>;
}
