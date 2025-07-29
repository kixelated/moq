import type { AnnouncedConsumer } from "./announced";
import type { BroadcastConsumer } from "./broadcast";
import type * as Path from "./path";

export interface Connection {
	readonly url: URL;

	announced(prefix?: Path.Valid): AnnouncedConsumer;
	publish(name: Path.Valid, broadcast: BroadcastConsumer): void;
	consume(broadcast: Path.Valid): BroadcastConsumer;
	close(): void;
	closed(): Promise<void>;
}
