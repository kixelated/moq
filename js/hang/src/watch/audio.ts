import type * as Moq from "@kixelated/moq";
import { Effect, type Getter, Signal } from "@kixelated/signals";
import { Buffer } from "buffer";
import type * as Catalog from "../catalog";
import * as Container from "../container";
import type * as Worklet from "../worklet";

const MIN_GAIN = 0.001;
const FADE_TIME = 0.2;

export type AudioProps = {
	// Enable to download the audio track.
	enabled?: boolean;

	// The latency hint to use for the AudioContext.
	latency?: DOMHighResTimeStamp;

	// Enable to download the captions track.
	transcribe?: boolean;
};

// Downloads audio from a track and emits it to an AudioContext.
// The user is responsible for hooking up audio to speakers, an analyzer, etc.
export class Audio {
	broadcast: Getter<Moq.BroadcastConsumer | undefined>;
	catalog: Getter<Catalog.Root | undefined>;
	enabled: Signal<boolean>;
	selected = new Signal<Catalog.Audio | undefined>(undefined);

	// The root of the audio graph, which can be used for custom visualizations.
	// You can access the audio context via `root.context`.
	#worklet = new Signal<AudioWorkletNode | undefined>(undefined);
	// Downcast to AudioNode so it matches Publish.
	readonly root = this.#worklet as Getter<AudioNode | undefined>;

	#sampleRate = new Signal<number | undefined>(undefined);
	readonly sampleRate: Getter<number | undefined> = this.#sampleRate;

	// Enable to download the captions track.
	transcribe: Signal<boolean>;

	// The most recent caption downloaded.
	#caption = new Signal<string | undefined>(undefined);
	readonly caption: Getter<string | undefined> = this.#caption;

	// Not a signal because it updates constantly.
	#buffered: DOMHighResTimeStamp = 0;

	// Not a signal because I'm lazy.
	readonly latency: DOMHighResTimeStamp;

	#signals = new Effect();

	constructor(
		broadcast: Getter<Moq.BroadcastConsumer | undefined>,
		catalog: Getter<Catalog.Root | undefined>,
		props?: AudioProps,
	) {
		this.broadcast = broadcast;
		this.catalog = catalog;
		this.enabled = new Signal(props?.enabled ?? false);
		this.latency = props?.latency ?? 100; // TODO Reduce this once fMP4 stuttering is fixed.
		this.transcribe = new Signal(props?.transcribe ?? false);

		this.#signals.effect((effect) => {
			this.selected.set(effect.get(this.catalog)?.audio?.[0]);
		});

		this.#signals.effect(this.#runWorklet.bind(this));
		this.#signals.effect(this.#runDecoder.bind(this));
		this.#signals.effect(this.#runCaption.bind(this));
	}

	#runWorklet(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		const selected = effect.get(this.selected);
		if (!enabled || !selected) return;

		const sampleRate = selected.config.sampleRate;
		const channelCount = selected.config.numberOfChannels;

		// NOTE: We still create an AudioContext even when muted.
		// This way we can process the audio for visualizations.

		const context = new AudioContext({ latencyHint: "interactive", sampleRate });
		effect.cleanup(() => context.close());

		effect.spawn(async () => {
			// Register the AudioWorklet processor
			await context.audioWorklet.addModule(new URL("../worklet/render.ts", import.meta.url));

			// Create the worklet node
			const worklet = new AudioWorkletNode(context, "render");
			effect.cleanup(() => worklet.disconnect());

			// Listen for buffer status updates (optional, for monitoring)
			worklet.port.onmessage = (event: MessageEvent<Worklet.Status>) => {
				const { type, available } = event.data;
				if (type === "status") {
					this.#buffered = (1000 * available) / sampleRate;
				}
			};

			worklet.port.postMessage({ type: "init", sampleRate, channelCount, latency: this.latency });

			effect.set(this.#worklet, worklet);
		});
	}

	#runDecoder(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

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
			try {
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
			} catch (error) {
				console.warn("audio subscription error", error);
			}
		});
	}

	#runCaption(effect: Effect): void {
		const enabled = effect.get(this.transcribe);
		if (!enabled) return;

		const broadcast = effect.get(this.broadcast);
		if (!broadcast) return;

		const selected = effect.get(this.selected);
		if (!selected) return;

		if (!selected.caption) return;

		const sub = broadcast.subscribe(selected.caption.name, selected.caption.priority);
		effect.cleanup(() => sub.close());

		effect.spawn(async (cancel) => {
			for (;;) {
				const frame = await Promise.race([sub.nextFrame(), cancel]);
				if (!frame) break;

				const text = frame.data.length > 0 ? new TextDecoder().decode(frame.data) : undefined;
				this.#caption.set(text);
			}
		});
		effect.cleanup(() => this.#caption.set(undefined));
	}

	#emit(sample: AudioData) {
		const worklet = this.#worklet.peek();
		if (!worklet) {
			// We're probably in the process of closing.
			sample.close();
			return;
		}

		const channelData: Float32Array[] = [];
		for (let channel = 0; channel < sample.numberOfChannels; channel++) {
			const data = new Float32Array(sample.numberOfFrames);
			sample.copyTo(data, { format: "f32-planar", planeIndex: channel });
			channelData.push(data);
		}

		const msg: Worklet.Data = {
			type: "data",
			data: channelData,
			timestamp: sample.timestamp,
		};

		// Send audio data to worklet via postMessage
		// TODO: At some point, use SharedArrayBuffer to avoid dropping samples.
		worklet.port.postMessage(
			msg,
			msg.data.map((data) => data.buffer),
		);

		sample.close();
	}

	close() {
		this.#signals.close();
	}

	get buffered() {
		return this.#buffered;
	}
}

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

	#signals = new Effect();

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

			effect.set(this.#gain, gain);
		});

		this.#signals.effect((effect) => {
			const gain = effect.get(this.#gain);
			if (!gain) return;

			// Cancel any scheduled transitions on change.
			effect.cleanup(() => gain.gain.cancelScheduledValues(gain.context.currentTime));

			const volume = effect.get(this.volume);
			if (volume < MIN_GAIN) {
				gain.gain.exponentialRampToValueAtTime(MIN_GAIN, gain.context.currentTime + FADE_TIME);
				gain.gain.setValueAtTime(0, gain.context.currentTime + FADE_TIME + 0.01);
			} else {
				gain.gain.exponentialRampToValueAtTime(volume, gain.context.currentTime + FADE_TIME);
			}
		});

		this.#signals.effect((effect) => {
			this.source.enabled.set(!effect.get(this.paused));
		});
	}

	close() {
		this.#signals.close();
	}
}
