import { Buffer } from "buffer";
import * as Moq from "@kixelated/moq";
import { Computed, Effect, Root, Signal } from "@kixelated/signals";
import * as Catalog from "../catalog";
import * as Container from "../container";

// An annoying hack, but there's stuttering that we need to fix.
const LATENCY = 50;

export type AudioEmitterProps = {
	volume?: number;
	muted?: boolean;
	paused?: boolean;
};

// A helper that emits audio directly to the speakers.
export class AudioEmitter {
	source: Audio;
	volume: Signal<number>;
	muted: Signal<boolean>;

	// Similar to muted, but controls whether we download audio at all.
	// That way we can be "muted" but also download audio for visualizations.
	paused: Signal<boolean>;

	#signals = new Root();

	// The volume to use when unmuted.
	#unmuteVolume = 0.5;

	// The gain node used to adjust the volume.
	#gain = new Signal<GainNode | undefined>(undefined);

	constructor(source: Audio, props?: AudioEmitterProps) {
		this.source = source;
		this.volume = new Signal(props?.volume ?? 0.5);
		this.muted = new Signal(props?.muted ?? false);
		this.paused = new Signal(props?.paused ?? props?.muted ?? false);

		// Set the volume to 0 when muted.
		this.#signals.effect((effect) => {
			const muted = effect.get(this.muted);
			if (muted) {
				this.#unmuteVolume = this.volume.peek() || 0.5;
				this.volume.set(0);
				this.source.enabled.set(false);
			} else {
				this.volume.set(this.#unmuteVolume);
				this.source.enabled.set(true);
			}
		});

		// Set unmute when the volume is non-zero.
		this.#signals.effect((effect) => {
			const volume = effect.get(this.volume);
			this.muted.set(volume === 0);
		});

		this.#signals.effect((effect) => {
			const root = effect.get(this.source.root);
			if (!root) return;

			const gain = new GainNode(root.context, { gain: effect.get(this.volume) });
			root.connect(gain);

			gain.connect(root.context.destination); // speakers
			effect.cleanup(() => gain.disconnect());

			this.#gain.set(gain);
			effect.cleanup(() => this.#gain.set(undefined));
		});

		this.#signals.effect((effect) => {
			const gain = effect.get(this.#gain);
			if (!gain) return;

			const volume = effect.get(this.volume);
			gain.gain.value = volume;
		});

		this.#signals.effect((effect) => {
			this.source.enabled.set(!effect.get(this.paused));
		});
	}

	close() {
		this.#signals.close();
	}
}

export type AudioProps = {
	enabled?: boolean;
};

// Downloads audio from a track and emits it to an AudioContext.
// The user is responsible for hooking up audio to speakers, an analyzer, etc.
export class Audio {
	broadcast: Signal<Moq.BroadcastConsumer | undefined>;
	catalog: Signal<Catalog.Root | undefined>;
	enabled: Signal<boolean>;
	selected: Computed<Catalog.Audio | undefined>;

	// The root of the audio graph, which can be used for custom visualizations.
	// You can access the audio context via `root.context`.
	#root = new Signal<AudioNode | undefined>(undefined);
	readonly root = this.#root.readonly();

	#sampleRate = new Signal<number | undefined>(undefined);
	readonly sampleRate = this.#sampleRate.readonly();

	// Reusable audio buffers.
	#buffers: AudioBuffer[] = [];
	#active: { node: AudioBufferSourceNode; timestamp: number }[] = [];

	// Used to convert from timestamp units to AudioContext units.
	#ref?: number;

	#signals = new Root();

	constructor(
		broadcast: Signal<Moq.BroadcastConsumer | undefined>,
		catalog: Signal<Catalog.Root | undefined>,
		props?: AudioProps,
	) {
		this.broadcast = broadcast;
		this.catalog = catalog;
		this.enabled = new Signal(props?.enabled ?? false);

		this.selected = this.#signals.computed((effect) => effect.get(this.catalog)?.audio?.[0]);

		// Stop all active samples when disabled.
		this.#signals.effect((effect) => {
			const enabled = effect.get(this.enabled);
			if (enabled) return;

			for (const active of this.#active) {
				active.node.stop();
			}
		});

		this.#signals.effect((effect) => {
			const enabled = effect.get(this.enabled);
			if (!enabled) return undefined;

			const sampleRate = effect.get(this.#sampleRate);
			if (!sampleRate) return undefined;

			// NOTE: We still create an AudioContext even when muted.
			// This way we can process the audio for visualizations.

			const context = new AudioContext({ latencyHint: "interactive", sampleRate });
			if (context.state === "suspended") {
				// Force disabled if autoplay restrictions are preventing us from playing.
				this.enabled.set(false);
				return;
			}

			effect.cleanup(() => context.close());

			// Make a dummy gain node that we can expose.
			const node = new GainNode(context, { gain: 1 });
			effect.cleanup(() => node.disconnect());

			this.#root.set(node);
			effect.cleanup(() => this.#root.set(undefined));
		});

		this.#signals.effect(this.#init.bind(this));
	}

	#init(effect: Effect): void {
		if (!effect.get(this.enabled)) return;

		const selected = effect.get(this.selected);
		if (!selected) return;

		const broadcast = effect.get(this.broadcast);
		if (!broadcast) return;

		const sub = broadcast.subscribe(selected.track.name, selected.track.priority);
		effect.cleanup(() => sub.close());

		const decoder = new AudioDecoder({
			output: (data) => this.#emit(data),
			error: (error) => console.error(error),
		});
		effect.cleanup(() => decoder.close());

		const config = selected.config;

		decoder.configure({
			...config,
			description: config.description ? Buffer.from(config.description, "hex") : undefined,
		});

		effect.spawn(async (cancel) => {
			for (;;) {
				const frame = await Promise.race([sub.nextFrame(), cancel]);
				if (!frame) break;

				const decoded = Container.decodeFrame(frame.data);

				const chunk = new EncodedAudioChunk({
					type: "key",
					data: decoded.data,
					timestamp: decoded.timestamp,
				});

				decoder.decode(chunk);
			}
		});
	}

	#emit(sample: AudioData) {
		this.#sampleRate.set(sample.sampleRate);

		const root = this.#root.peek();
		if (!root) {
			sample.close();
			return;
		}

		// Convert from microseconds to seconds.
		const timestamp = sample.timestamp / 1_000_000;

		// The maximum latency in seconds, including a full frame size.
		const maxLatency = sample.numberOfFrames / sample.sampleRate + LATENCY / 1000;

		if (!this.#ref) {
			this.#ref = timestamp - root.context.currentTime - maxLatency;
		}

		// Determine when the sample should be played in AudioContext units.
		let when = timestamp - this.#ref;
		const latency = when - root.context.currentTime;
		if (latency < 0) {
			// Can't play in the past.
			sample.close();
			return;
		}

		if (latency > maxLatency) {
			// We went over the max latency, so we need a new ref.
			this.#ref = timestamp - root.context.currentTime - maxLatency;

			// Cancel any active samples and let them reschedule themselves if needed.
			for (const active of this.#active) {
				active.node.stop();
			}

			// Schedule the sample to play at the max latency.
			when = root.context.currentTime + maxLatency;
		}

		// Create an audio buffer for this sample.
		const buffer = this.#createBuffer(sample, root.context);
		this.#scheduleBuffer(root, buffer, timestamp, when);
	}

	#createBuffer(sample: AudioData, context: BaseAudioContext): AudioBuffer {
		let buffer: AudioBuffer | undefined;

		while (this.#buffers.length > 0) {
			const reuse = this.#buffers.shift();
			if (
				reuse &&
				reuse.sampleRate === sample.sampleRate &&
				reuse.numberOfChannels === sample.numberOfChannels &&
				reuse.length === sample.numberOfFrames
			) {
				buffer = reuse;
				break;
			}
		}

		if (!buffer) {
			buffer = context.createBuffer(sample.numberOfChannels, sample.numberOfFrames, sample.sampleRate);
		}

		// Copy the sample data to the buffer.
		for (let channel = 0; channel < sample.numberOfChannels; channel++) {
			const channelData = new Float32Array(sample.numberOfFrames);
			sample.copyTo(channelData, { format: "f32-planar", planeIndex: channel });
			buffer.copyToChannel(channelData, channel);
		}
		sample.close();

		return buffer;
	}

	#scheduleBuffer(root: AudioNode, buffer: AudioBuffer, timestamp: number, when: number) {
		const source = root.context.createBufferSource();
		source.buffer = buffer;
		source.connect(root);
		source.onended = () => {
			// Remove ourselves from the active list.
			// This is super gross and probably wrong, but yolo.
			this.#active.shift();

			// Check if we need to reschedule this sample because it was cancelled.
			if (this.#ref) {
				const newWhen = timestamp - this.#ref;
				if (newWhen > root.context.currentTime) {
					// Reschedule the sample to play at the new time.
					this.#scheduleBuffer(root, buffer, timestamp, newWhen);
					return;
				}
			}

			this.#buffers.push(buffer);
		};
		source.start(when);

		this.#active.push({ node: source, timestamp });
	}

	close() {
		this.#signals.close();
	}
}
