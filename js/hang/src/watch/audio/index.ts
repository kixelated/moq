import type * as Moq from "@kixelated/moq";
import { Effect, type Getter, Signal } from "@kixelated/signals";
import { Buffer } from "buffer";
import type * as Catalog from "../../catalog";
import * as Container from "../../container";
import type * as Render from "./render";

export * from "./emitter";

// Unfortunately, we need to use a Vite-exclusive import for now.
import RenderWorklet from "./render-worklet?worker&url";

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
			await context.audioWorklet.addModule(RenderWorklet);

			// Create the worklet node
			const worklet = new AudioWorkletNode(context, "render");
			effect.cleanup(() => worklet.disconnect());

			// Listen for buffer status updates (optional, for monitoring)
			worklet.port.onmessage = (event: MessageEvent<Render.Status>) => {
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

		if (!selected.captions) return;

		const sub = broadcast.subscribe(selected.captions.track.name, selected.captions.track.priority);
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

		const msg: Render.Data = {
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
