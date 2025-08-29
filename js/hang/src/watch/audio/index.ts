import type * as Moq from "@kixelated/moq";
import { Effect, type Getter, Signal } from "@kixelated/signals";
import type * as Catalog from "../../catalog";
import * as Frame from "../../frame";
import { loadAudioWorklet } from "../../util/hacks";
import * as Hex from "../../util/hex";
import { Captions, type CaptionsProps } from "./captions";
import type * as Render from "./render";
import { Speaking, type SpeakingProps } from "./speaking";

export * from "./emitter";

export type AudioProps = {
	// Enable to download the audio track.
	enabled?: boolean | Signal<boolean>;

	// The latency hint to use for the AudioContext.
	latency?: DOMHighResTimeStamp;

	// Enable to download the captions track.
	captions?: CaptionsProps;

	// Enable to download the speaking track. (boolean)
	speaking?: SpeakingProps;
};

// Downloads audio from a track and emits it to an AudioContext.
// The user is responsible for hooking up audio to speakers, an analyzer, etc.
export class Audio {
	broadcast: Getter<Moq.BroadcastConsumer | undefined>;
	catalog: Getter<Catalog.Root | undefined>;
	enabled: Signal<boolean>;
	info = new Signal<Catalog.Audio | undefined>(undefined);

	// The root of the audio graph, which can be used for custom visualizations.
	// You can access the audio context via `root.context`.
	#worklet = new Signal<AudioWorkletNode | undefined>(undefined);
	// Downcast to AudioNode so it matches Publish.
	readonly root = this.#worklet as Getter<AudioNode | undefined>;

	#sampleRate = new Signal<number | undefined>(undefined);
	readonly sampleRate: Getter<number | undefined> = this.#sampleRate;

	captions: Captions;
	speaking: Speaking;

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
		this.enabled = Signal.from(props?.enabled ?? false);
		this.latency = props?.latency ?? 100; // TODO Reduce this once fMP4 stuttering is fixed.
		this.captions = new Captions(broadcast, this.info, props?.captions);
		this.speaking = new Speaking(broadcast, this.info, props?.speaking);

		this.#signals.effect((effect) => {
			this.info.set(effect.get(this.catalog)?.audio?.[0]);
		});

		this.#signals.effect(this.#runWorklet.bind(this));
		this.#signals.effect(this.#runDecoder.bind(this));
	}

	#runWorklet(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		const info = effect.get(this.info);
		if (!enabled || !info) return;

		const sampleRate = info.config.sampleRate;
		const channelCount = info.config.numberOfChannels;

		// NOTE: We still create an AudioContext even when muted.
		// This way we can process the audio for visualizations.

		const context = new AudioContext({
			latencyHint: "interactive",
			sampleRate,
		});
		effect.cleanup(() => context.close());

		effect.spawn(async () => {
			// Register the AudioWorklet processor
			await context.audioWorklet.addModule(
				await loadAudioWorklet(() =>
					navigator.serviceWorker.register(new URL("./render-worklet", import.meta.url)),
				),
			);

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
			effect.cleanup(() => { worklet.port.onmessage = null; });

			worklet.port.postMessage({
				type: "init",
				sampleRate,
				channelCount,
				latency: this.latency,
			});

			effect.set(this.#worklet, worklet);
		});
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

		effect.spawn(async (cancel) => {
			try {
				for (;;) {
					const frame = await Promise.race([sub.readFrame(), cancel]);
					if (!frame) break;

					const decoded = Frame.decode(frame);

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
		this.captions.close();
		this.speaking.close();
	}

	get buffered() {
		return this.#buffered;
	}
}
