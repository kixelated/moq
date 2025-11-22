import type * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import type * as Catalog from "../../catalog";
import * as Frame from "../../frame";
import { PRIORITY } from "../../publish/priority";
import * as Time from "../../time";
import * as Hex from "../../util/hex";

export type SourceProps = {
	enabled?: boolean | Signal<boolean>;

	// Jitter buffer size in milliseconds (default: 100ms)
	// When using b-frames, this should to be larger than the frame duration.
	latency?: Time.Milli | Signal<Time.Milli>;
};

export type Target = {
	// The desired size of the video in pixels.
	pixels?: number;

	// TODO bitrate
};

// The types in VideoDecoderConfig that cause a hard reload.
// ex. codedWidth/Height are optional and can be changed in-band, so we don't want to trigger a reload.
// This way we can keep the current subscription active.
type RequiredDecoderConfig = Omit<Catalog.VideoConfig, "codedWidth" | "codedHeight">;

export const PlayerStatusReason = {
	BUFFER_EMPTY: "BUFFER_EMPTY",
	BUFFER_FILLED: "BUFFER_FILLED",
	SYNC_WAIT: "SYNC_WAIT",
	SYNC_READY: "SYNC_READY",
} as const;

type PlayerStatusReason = typeof PlayerStatusReason[keyof typeof PlayerStatusReason];

type BufferStatus = {
	reason: typeof PlayerStatusReason.BUFFER_EMPTY | typeof PlayerStatusReason.BUFFER_FILLED;
	stallDuration?: number;
};

type SyncStatus = {
	reason: typeof PlayerStatusReason.SYNC_WAIT | typeof PlayerStatusReason.SYNC_READY;
	elapsedWait?: number;
	bufferDuration?: number;
};

type PlayerStatusEvent = BufferStatus | SyncStatus;

// Responsible for switching between video tracks and buffering frames.
export class Source {
	#MIN_SYNC_WAIT_MS = 50 as Time.Milli;

	broadcast: Signal<Moq.Broadcast | undefined>;
	enabled: Signal<boolean>; // Don't download any longer

	catalog = new Signal<Catalog.Video | undefined>(undefined);

	// The tracks supported by our video decoder.
	#supported = new Signal<Record<string, Catalog.VideoConfig>>({});

	// The track we chose from the supported tracks.
	#selected = new Signal<string | undefined>(undefined);
	#selectedConfig = new Signal<RequiredDecoderConfig | undefined>(undefined);

	// The name of the active rendition.
	active = new Signal<string | undefined>(undefined);

	// The current track running, held so we can cancel it when the new track is ready.
	#pending?: Effect;
	#active?: Effect;

	// Used as a tiebreaker when there are multiple tracks (HD vs SD).
	target = new Signal<Target | undefined>(undefined);

	// Unfortunately, browsers don't let us hold on to multiple VideoFrames.
	// ex. Firefox only allows 2 outstanding VideoFrames at a time.
	// In order to semi-support b-frames, we buffer two frames and expose the earliest one.
	frame = new Signal<VideoFrame | undefined>(undefined);
	#next?: VideoFrame;

	latency: Signal<Time.Milli>;

	// The display size of the video in pixels, ideally sourced from the catalog.
	display = new Signal<{ width: number; height: number } | undefined>(undefined);

	// Whether to flip the video horizontally.
	flip = new Signal<boolean | undefined>(undefined);

	// Used to convert PTS to wall time.
	#reference: DOMHighResTimeStamp | undefined;

	// The latency after we've accounted for the extra frame buffering and jitter buffer.
	#jitter: Signal<Time.Milli>;

	bufferStatus = new Signal<PlayerStatusEvent>({ reason: PlayerStatusReason.BUFFER_EMPTY });
	#bufferStallStartTime: number | null = null;

	syncWaitStatus = new Signal<PlayerStatusEvent>({ reason: PlayerStatusReason.SYNC_READY });

	#signals = new Effect();

	constructor(
		broadcast: Signal<Moq.Broadcast | undefined>,
		catalog: Signal<Catalog.Root | undefined>,
		props?: SourceProps,
	) {
		this.broadcast = broadcast;
		this.latency = Signal.from(props?.latency ?? (100 as Time.Milli));
		this.enabled = Signal.from(props?.enabled ?? false);

		// We subtract a frame from the jitter buffer to account for the extra buffered frame.
		// Assume 30fps by default.
		this.#jitter = new Signal(Math.max(0, this.latency.peek() - 33) as Time.Milli);

		this.#signals.effect((effect) => {
			const c = effect.get(catalog)?.video;
			effect.set(this.catalog, c);
			effect.set(this.flip, c?.flip);
		});

		this.#signals.effect(this.#runSupported.bind(this));
		this.#signals.effect(this.#runSelected.bind(this));
		this.#signals.effect(this.#runPending.bind(this));
		this.#signals.effect(this.#runDisplay.bind(this));
		this.#signals.effect(this.#runJitter.bind(this));

		this.#signals.effect((effect) => {
			const currentFrame = effect.get(this.frame);
			const nextFrame = this.#next;
			const enabled = effect.get(this.enabled);

			const isBufferEmpty = enabled && !currentFrame && !nextFrame;

			if (isBufferEmpty && this.#bufferStallStartTime === null) {
				this.#bufferStallStartTime = Date.now();
				this.bufferStatus.set({ reason: PlayerStatusReason.BUFFER_EMPTY });
			} else if (enabled && !isBufferEmpty && this.#bufferStallStartTime !== null) {
				// How long the buffer was empty/stalled
				const stallDuration: number = Date.now() - this.#bufferStallStartTime;
				this.bufferStatus.set({
					reason: PlayerStatusReason.BUFFER_FILLED,
					stallDuration,
				});
				this.#bufferStallStartTime = null;
			} else if (!enabled && this.#bufferStallStartTime !== null) {
				this.#bufferStallStartTime = null;
			}
		});
	}

	#runSupported(effect: Effect): void {
		const renditions = effect.get(this.catalog)?.renditions ?? {};

		effect.spawn(async () => {
			const supported: Record<string, Catalog.VideoConfig> = {};

			for (const [name, rendition] of Object.entries(renditions)) {
				const description = rendition.description ? Hex.toBytes(rendition.description) : undefined;

				const { supported: valid } = await VideoDecoder.isConfigSupported({
					...rendition,
					description,
					optimizeForLatency: rendition.optimizeForLatency ?? true,
				});
				if (valid) supported[name] = rendition;
			}

			if (Object.keys(supported).length === 0 && Object.keys(renditions).length > 0) {
				console.warn("no supported renditions found, available: ", renditions);
			}

			this.#supported.set(supported);
		});
	}

	#runSelected(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const supported = effect.get(this.#supported);
		const target = effect.get(this.target);

		const selected = this.#selectRendition(supported, target);
		if (!selected) return;

		effect.set(this.#selected, selected);

		// Remove the codedWidth/Height from the config to avoid a hard reload if nothing else has changed.
		const config = { ...supported[selected], codedWidth: undefined, codedHeight: undefined };
		effect.set(this.#selectedConfig, config);
	}

	#runPending(effect: Effect): void {
		const broadcast = effect.get(this.broadcast);
		const enabled = effect.get(this.enabled);
		const selected = effect.get(this.#selected);
		const config = effect.get(this.#selectedConfig);

		if (!broadcast || !selected || !config || !enabled) {
			// Stop the active track.
			this.#active?.close();
			this.#active = undefined;

			this.frame.update((prev) => {
				prev?.close();
				return undefined;
			});

			this.#next?.close();
			this.#next = undefined;

			return;
		}

		// Start a new pending effect.
		this.#pending = new Effect();

		// NOTE: If the track catches up in time, it'll remove itself from #pending.
		// We use #pending here on purpose so we only close it when it hasn't caught up yet.
		effect.cleanup(() => this.#pending?.close());

		this.#runTrack(this.#pending, broadcast, selected, config);
	}

	#runTrack(effect: Effect, broadcast: Moq.Broadcast, name: string, config: RequiredDecoderConfig): void {
		const sub = broadcast.subscribe(name, PRIORITY.video); // TODO use priority from catalog
		effect.cleanup(() => sub.close());

		// Create consumer that reorders groups/frames up to the provided latency.
		const consumer = new Frame.Consumer(sub, {
			latency: this.#jitter,
		});
		effect.cleanup(() => consumer.close());

		const decoder = new VideoDecoder({
			output: (frame) => {
				// Keep track of the two newest frames.
				// this.frame is older than this.#next, if it exists.
				const prev = this.frame.peek();
				if (prev && prev.timestamp >= frame.timestamp) {
					// NOTE: This can happen if you have more than 1 b-frame in a row.
					// Sorry, blame Firefox.
					frame.close();
					return;
				}

				if (!prev) {
					// As time-to-video optimization, use the first frame we see.
					// We know this is an i-frame so there's no need to re-order it.
					this.frame.set(frame);
					return;
				}

				// If jitter is 0, then we disable buffering frames.
				const jitter = this.#jitter.peek();
				if (jitter === 0) {
					prev.close();
					this.frame.set(frame);
					return;
				}

				if (!this.#next) {
					// We know we're newer than the current frame, so buffer it.
					this.#next = frame;
					return;
				}

				// Close the previous frame, and check if we need to replace #next or this.frame.
				prev.close();

				if (this.#next.timestamp < frame.timestamp) {
					// Replace #next with the new frame.
					this.frame.set(this.#next);
					this.#next = frame;
				} else {
					// #next is newer than this new frame, so keep it.
					this.frame.set(frame);
				}
			},
			// TODO bubble up error
			error: (error) => {
				console.error(error);
				effect.close();
			},
		});
		effect.cleanup(() => decoder.close());

		decoder.configure({
			...config,
			description: config.description ? Hex.toBytes(config.description) : undefined,
			optimizeForLatency: config.optimizeForLatency ?? true,
			// @ts-expect-error Only supported by Chrome, so the renderer has to flip manually.
			flip: false,
		});

		effect.spawn(async () => {
			for (;;) {
				const next = await Promise.race([consumer.decode(), effect.cancel]);
				if (!next) break;

				// See if we can upgrade ourselves to the active track once we catch up.
				// TODO: This is a racey when latency === 0, but I think it's fine.
				const prev = this.frame.peek();
				if (this.#pending === effect && (!prev || next.timestamp > prev.timestamp)) {
					this.#active?.close();
					this.#active = effect;
					this.#pending = undefined;
					effect.set(this.active, name);
				}

				// Sleep until it's time to decode the next frame.
				const ref = performance.now() - Time.Milli.fromMicro(next.timestamp);

				if (!this.#reference || ref < this.#reference) {
					this.#reference = ref;
				} else {
					const sleep = this.#reference - ref + this.#jitter.peek();
					const isWaitRequired = sleep >= this.#MIN_SYNC_WAIT_MS;
					if (sleep > 0) {
						const startTime: number = Date.now();
						// The planned jitter buffer size
						const bufferDuration: Time.Milli = this.#jitter.peek();

						if (isWaitRequired) {
							this.syncWaitStatus.set({ reason: PlayerStatusReason.SYNC_WAIT, bufferDuration });
						}

						await new Promise((resolve) => setTimeout(resolve, sleep));

						if (isWaitRequired) {
							// How long the sync wait actually took
							const elapsedWait: number = Date.now() - startTime;
							this.syncWaitStatus.set({ reason: PlayerStatusReason.SYNC_READY, elapsedWait, bufferDuration });
						}
					} else {
						this.syncWaitStatus.set({ reason: PlayerStatusReason.SYNC_READY });
					}
				}

				if (decoder.state === "closed") {
					// Closed during the sleep
					break;
				}

				const chunk = new EncodedVideoChunk({
					type: next.keyframe ? "key" : "delta",
					data: next.data,
					timestamp: next.timestamp,
				});

				decoder.decode(chunk);
			}
		});
	}

	#selectRendition(renditions: Record<string, Catalog.VideoConfig>, target?: Target): string | undefined {
		const entries = Object.entries(renditions);
		if (entries.length <= 1) return entries.at(0)?.[0];

		// If we have no target, then choose the largest supported rendition.
		// This is kind of a hack to use MAX_SAFE_INTEGER / 2 - 1 but IF IT WORKS, IT WORKS.
		const pixels = target?.pixels ?? Number.MAX_SAFE_INTEGER / 2 - 1;

		// Round up to the closest rendition.
		// Also keep track of the 2nd closest, just in case there's nothing larger.

		let larger: string | undefined;
		let largerSize: number | undefined;

		let smaller: string | undefined;
		let smallerSize: number | undefined;

		for (const [name, rendition] of entries) {
			if (!rendition.codedHeight || !rendition.codedWidth) continue;

			const size = rendition.codedHeight * rendition.codedWidth;
			if (size > pixels && (!largerSize || size < largerSize)) {
				larger = name;
				largerSize = size;
			} else if (size < pixels && (!smallerSize || size > smallerSize)) {
				smaller = name;
				smallerSize = size;
			}
		}
		if (larger) return larger;
		if (smaller) return smaller;

		console.warn("no width/height information, choosing the first supported rendition");
		return entries[0][0];
	}

	#runDisplay(effect: Effect): void {
		const catalog = effect.get(this.catalog);
		if (!catalog) return;

		const display = catalog.display;
		if (display) {
			effect.set(this.display, {
				width: display.width,
				height: display.height,
			});
			return;
		}

		const frame = effect.get(this.frame);
		if (!frame) return;

		effect.set(this.display, {
			width: frame.displayWidth,
			height: frame.displayHeight,
		});
	}

	#runJitter(effect: Effect): void {
		const config = effect.get(this.#selectedConfig);
		if (!config) return;

		// Use the framerate to compute the jitter buffer size.
		// We always buffer a single frame, so subtract that from the jitter buffer.
		const fps = config.framerate && config.framerate > 0 ? config.framerate : 30;
		const delay = 1000 / fps;
		const latency = effect.get(this.latency);

		const jitter = Math.max(0, latency - delay) as Time.Milli;
		this.#jitter.set(jitter);

		// If we're not buffering any frames, then close the next frame.
		if (jitter === 0 && this.#next) {
			this.#next.close();
			this.#next = undefined;
		}
	}

	close() {
		this.frame.update((prev) => {
			prev?.close();
			return undefined;
		});

		this.#next?.close();
		this.#next = undefined;

		this.#signals.close();
	}
}
