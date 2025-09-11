import type { AnnouncedConsumer } from "./announced.ts";
import type { BroadcastConsumer } from "./broadcast.ts";
import type * as Path from "./path.ts";

// Both moq-lite and moq-ietf implement this.
export interface Connection {
	readonly url: URL;

	announced(prefix?: Path.Valid): AnnouncedConsumer;
	publish(name: Path.Valid, broadcast: BroadcastConsumer): void;
	consume(broadcast: Path.Valid): BroadcastConsumer;
	close(): void;
	closed(): Promise<void>;
}
