import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import type * as Catalog from "../../catalog";
import { u8 } from "../../catalog";
import { loadAudioWorklet } from "../../util/hacks";
import type { Audio } from ".";
import type { Request, Result } from "./captions-worker";

export type CaptionsProps = {
	enabled?: boolean;
	transcribe?: boolean;

	// Captions are cleared after this many milliseconds. (10s default)
	ttl?: DOMHighResTimeStamp;
};

export class Captions {
	audio: Audio;

	// Enable caption generation via an on-device model (whisper).
	enabled: Signal<boolean>;

	text = new Signal<string | undefined>(undefined);
	catalog = new Signal<Catalog.Captions | undefined>(undefined);

	signals = new Effect();

	#ttl: DOMHighResTimeStamp;

	#track = new Moq.TrackProducer("captions.txt", 1);

	constructor(audio: Audio, props?: CaptionsProps) {
		this.audio = audio;
		this.#ttl = props?.ttl ?? 10000;
		this.enabled = new Signal(props?.enabled ?? false);

		this.signals.effect(this.#run.bind(this));
	}

	#run(effect: Effect): void {
		if (!effect.get(this.enabled)) return;

		const media = effect.get(this.audio.source);
		if (!media) return;

		this.audio.broadcast.insertTrack(this.#track.consume());
		effect.cleanup(() => this.audio.broadcast.removeTrack(this.#track.name));

		const catalog: Catalog.Captions = {
			track: {
				name: this.#track.name,
				priority: u8(this.#track.priority),
			},
		};
		effect.set(this.catalog, catalog);

		// Create a nested effect to avoid recreating the track every time the caption changes.
		effect.effect((nested) => {
			const text = nested.get(this.text) ?? "";
			this.#track.writeString(text);

			// Clear the caption after a timeout. (TODO based on the size)
			nested.timer(() => this.text.set(undefined), this.#ttl);
		});

		const worker = new Worker(new URL("./captions-worker", import.meta.url), { type: "module" });
		effect.cleanup(() => worker.terminate());

		// Handle messages from the worker
		worker.onmessage = ({ data }: MessageEvent<Result>) => {
			if (data.type === "text") {
				this.text.set(data.text);
			} else if (data.type === "error") {
				console.error("VAD worker error:", data.message);
				this.text.set(undefined);
			}
		};

		effect.cleanup(() => {
			this.text.set(undefined);
		});

		const ctx = new AudioContext({
			latencyHint: "interactive",
			sampleRate: 16000, // required by the model.
		});
		effect.cleanup(() => ctx.close());

		// Create the source node.
		const root = new MediaStreamAudioSourceNode(ctx, {
			mediaStream: new MediaStream([media]),
		});
		effect.cleanup(() => root.disconnect());

		// The workload needs to be loaded asynchronously, unfortunately, but it should be instant.
		effect.spawn(async () => {
			await ctx.audioWorklet.addModule(
				await loadAudioWorklet(() =>
					navigator.serviceWorker.register(new URL("./capture-worklet", import.meta.url)),
				),
			);

			// Create the worklet.
			const worklet = new AudioWorkletNode(ctx, "capture", {
				numberOfInputs: 1,
				numberOfOutputs: 0,
				channelCount: 1,
				channelCountMode: "explicit",
				channelInterpretation: "discrete",
			});
			effect.cleanup(() => worklet.disconnect());

			root.connect(worklet);

			const init: Request = {
				type: "init",
				worklet: worklet.port,
			};
			worker.postMessage(init, [init.worklet]);
		});

		effect.effect((nested) => {
			if (!nested.get(this.audio.speaking.enabled)) {
				console.warn("VAD needs to be enabled to transcribe");
				return;
			}
			const speaking = nested.get(this.audio.speaking.active);
			worker.postMessage({ type: "speaking", speaking });
		});
	}

	close() {
		this.signals.close();
	}
}
