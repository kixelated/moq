import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import type * as Catalog from "../../catalog";
import { u8 } from "../../catalog";
import type { Audio } from ".";
import type { Request, Result } from "./captions-worker";
import CaptionsWorklet from "./captions-worklet?worker&url";

export type CaptionsProps = {
	enabled?: boolean;
	ttl?: number;
};

export class Captions {
	audio: Audio;

	// Enable caption generation via an on-device model (whisper).
	// This will publish a "captions" track and set the signals `speaking` and `text`.
	enabled: Signal<boolean>;

	speaking = new Signal<boolean | undefined>(undefined);
	text = new Signal<string | undefined>(undefined);
	catalog = new Signal<Catalog.Captions | undefined>(undefined);

	signals = new Effect();

	#ttl: DOMHighResTimeStamp;
	#track = new Moq.TrackProducer("captions.text", 1);

	constructor(audio: Audio, props?: CaptionsProps) {
		this.audio = audio;
		this.#ttl = props?.ttl ?? 10000;
		this.enabled = new Signal(props?.enabled ?? false);

		this.signals.effect(this.#run.bind(this));
	}

	#run(effect: Effect): void {
		if (!effect.get(this.enabled)) return;

		const media = effect.get(this.audio.media);
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
			this.#track.appendFrame(new TextEncoder().encode(text));

			// Clear the caption after a timeout. (TODO based on the size)
			nested.timer(() => this.text.set(undefined), this.#ttl);
		});

		const worker = new Worker(new URL("./captions-worker", import.meta.url), { type: "module" });
		effect.cleanup(() => worker.terminate());

		// Handle messages from the worker
		worker.onmessage = ({ data }: MessageEvent<Result>) => {
			if (data.type === "speaking") {
				// Use heuristics to determine if we've toggled speaking or not
				this.speaking.set(data.speaking);
			} else if (data.type === "text") {
				this.text.set(data.text);
			} else if (data.type === "error") {
				console.error("VAD worker error:", data.message);
				this.speaking.set(undefined);
				this.text.set(undefined);
			}
		};

		effect.cleanup(() => {
			this.speaking.set(undefined);
			this.text.set(undefined);
		});

		const ctx = new AudioContext({
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
			await ctx.audioWorklet.addModule(CaptionsWorklet);

			// Create the worklet.
			const worklet = new AudioWorkletNode(ctx, "captions", {
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
	}

	close() {
		this.signals.close();
	}
}
