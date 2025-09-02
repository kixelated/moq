import type * as Moq from "@kixelated/moq";
import { Effect, type Getter, Signal } from "@kixelated/signals";
import type * as Catalog from "../../catalog";
import * as Frame from "../../frame";
import type * as Time from "../../time";
import * as Hex from "../../util/hex";
import type * as Render from "./render";

export * from "./emitter";

import { Captions, type CaptionsProps } from "./captions";
import { Speaking, type SpeakingProps } from "./speaking";

// We want some extra overhead to avoid starving the render worklet.
// The default Opus frame duration is 20ms.
// TODO: Put it in the catalog so we don't have to guess.
const JITTER_UNDERHEAD = 25 as Time.Milli;

export type AudioProps = {
	// Enable to download the audio track.
	enabled?: boolean | Signal<boolean>;

	// The latency hint to use for the AudioContext.
	latency?: Time.Milli;

	// Enable to download the captions track.
	captions?: CaptionsProps;

	// Enable to download the speaking track. (boolean)
	speaking?: SpeakingProps;
};

// Unfortunately, we need to use a Vite-exclusive import for now.
import RenderWorklet from "./render-worklet?worker&url";

// Downloads audio from a track and emits it to an AudioContext.
// The user is responsible for hooking up audio to speakers, an analyzer, etc.
export class Audio {
	broadcast: Getter<Moq.BroadcastConsumer | undefined>;
	catalog: Getter<Catalog.Root | undefined>;
	enabled: Signal<boolean>;
	info = new Signal<Catalog.Audio | undefined>(undefined);

	#context = new Signal<AudioContext | undefined>(undefined);
	readonly context: Getter<AudioContext | undefined> = this.#context;

	// The root of the audio graph, which can be used for custom visualizations.
	#worklet = new Signal<AudioWorkletNode | undefined>(undefined);
	// Downcast to AudioNode so it matches Publish.Audio
	readonly root = this.#worklet as Getter<AudioNode | undefined>;

	#sampleRate = new Signal<number | undefined>(undefined);
	readonly sampleRate: Getter<number | undefined> = this.#sampleRate;

	captions: Captions;
	speaking: Speaking;

	// Not a signal because I'm lazy.
	readonly latency: Time.Milli;

	#signals = new Effect();

	constructor(
		broadcast: Getter<Moq.BroadcastConsumer | undefined>,
		catalog: Getter<Catalog.Root | undefined>,
		props?: AudioProps,
	) {
		this.broadcast = broadcast;
		this.catalog = catalog;
		this.enabled = Signal.from(props?.enabled ?? false);
		this.latency = props?.latency ?? (100 as Time.Milli); // TODO Reduce this once fMP4 stuttering is fixed.
		this.captions = new Captions(broadcast, this.info, props?.captions);
		this.speaking = new Speaking(broadcast, this.info, props?.speaking);

		this.#signals.effect((effect) => {
			this.info.set(effect.get(this.catalog)?.audio?.[0]);
		});

		this.#signals.effect(this.#runWorklet.bind(this));
		this.#signals.effect(this.#runEnabled.bind(this));
		this.#signals.effect(this.#runDecoder.bind(this));
	}

	#runWorklet(effect: Effect): void {
		// It takes a second or so to initialize the AudioContext/AudioWorklet, so do it even if disabled.
		// This is less efficient for video-only playback but makes muting/unmuting instant.

		//const enabled = effect.get(this.enabled);
		//if (!enabled) return;

		const info = effect.get(this.info);
		if (!info) return;

		const sampleRate = info.config.sampleRate;
		const channelCount = info.config.numberOfChannels;

		// NOTE: We still create an AudioContext even when muted.
		// This way we can process the audio for visualizations.

		const context = new AudioContext({
			latencyHint: "interactive", // We don't use real-time because of the jitter buffer.
			sampleRate,
		});
		effect.set(this.#context, context);

		effect.cleanup(() => context.close());

		effect.spawn(async () => {
			// Register the AudioWorklet processor
			await context.audioWorklet.addModule(RenderWorklet);

			// Create the worklet node
			const worklet = new AudioWorkletNode(context, "render", {
				channelCount,
				channelCountMode: "explicit",
			});
			effect.cleanup(() => worklet.disconnect());

			const init: Render.Init = {
				type: "init",
				rate: sampleRate,
				channels: channelCount,
				latency: this.latency,
			};
			worklet.port.postMessage(init);

			effect.set(this.#worklet, worklet);
		});
	}

	#runEnabled(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const context = effect.get(this.#context);
		if (!context) return;

		context.resume();

		// NOTE: You should disconnect/reconnect the worklet to save power when disabled.
	}

	#runDecoder(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const info = effect.get(this.info);
		if (!info) return;

		const broadcast = effect.get(this.broadcast);
		if (!broadcast) return;

		const sub = broadcast.subscribe(info.track.name, info.track.priority);
		effect.cleanup(() => sub.close());

		const decoder = new AudioDecoder({
			output: (data) => this.#emit(data),
			error: (error) => console.error(error),
		});
		effect.cleanup(() => decoder.close());

		const config = info.config;
		const description = config.description ? Hex.toBytes(config.description) : undefined;

		decoder.configure({
			...config,
			description,
		});

		// Create consumer with slightly less latency than the render worklet to avoid underflowing.
		const consumer = new Frame.Consumer(sub, {
			latency: Math.max(this.latency - JITTER_UNDERHEAD, 0) as Time.Milli,
		});
		effect.cleanup(() => consumer.close());

		effect.spawn(async (cancel) => {
			for (;;) {
				const frame = await Promise.race([consumer.decode(), cancel]);
				if (!frame) break;

				const chunk = new EncodedAudioChunk({
					type: frame.keyframe ? "key" : "delta",
					data: frame.data,
					timestamp: frame.timestamp,
				});

				decoder.decode(chunk);
			}
		});
	}

	#emit(sample: AudioData) {
		const timestamp = sample.timestamp as Time.Micro;

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
			timestamp,
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
		this.captions.close();
		this.speaking.close();
	}
}
