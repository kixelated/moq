import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import type * as Catalog from "../../catalog";
import { u8 } from "../../catalog";
import type { Audio } from ".";
import CaptureWorklet from "./capture-worklet?worker&url";
import type { Request, Result } from "./speaking-worker";

export type SpeakingProps = {
	enabled?: boolean | Signal<boolean>;
};

// Detects when the user is speaking.
export class Speaking {
	audio: Audio;
	enabled: Signal<boolean>;

	active = new Signal<boolean>(false);
	catalog = new Signal<Catalog.Speaking | undefined>(undefined);

	signals = new Effect();

	#track = new Moq.TrackProducer("speaking.bool", 1);

	constructor(audio: Audio, props?: SpeakingProps) {
		this.audio = audio;
		this.enabled = Signal.from(props?.enabled ?? false);
		this.signals.effect(this.#run.bind(this));
	}

	#run(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const source = effect.get(this.audio.source);
		if (!source) return;

		this.audio.broadcast.insertTrack(this.#track.consume());
		effect.cleanup(() => this.audio.broadcast.removeTrack(this.#track.name));

		const catalog: Catalog.Speaking = {
			track: {
				name: this.#track.name,
				priority: u8(this.#track.priority),
			},
		};
		effect.set(this.catalog, catalog);

		// Create a nested effect to avoid recreating the track every time the speaking changes.
		effect.effect((nested) => {
			const active = nested.get(this.active);
			this.#track.writeBool(active);
		});

		const worker = new Worker(new URL("./speaking-worker", import.meta.url), { type: "module" });
		effect.cleanup(() => worker.terminate());

		// Handle messages from the worker
		worker.onmessage = ({ data }: MessageEvent<Result>) => {
			if (data.type === "speaking") {
				// Use heuristics to determine if we've toggled speaking or not
				this.active.set(data.speaking);
			} else if (data.type === "error") {
				console.error("VAD worker error:", data.message);
				this.active.set(false);
			}
		};

		effect.cleanup(() => {
			worker.onmessage = null;
			this.active.set(false);
		});

		const ctx = new AudioContext({
			latencyHint: "interactive",
			sampleRate: 16000, // required by the model.
		});
		effect.cleanup(() => ctx.close());

		// Create the source node.
		const root = new MediaStreamAudioSourceNode(ctx, {
			mediaStream: new MediaStream([source]),
		});
		effect.cleanup(() => root.disconnect());

		// The workload needs to be loaded asynchronously, unfortunately, but it should be instant.
		effect.spawn(async () => {
			await ctx.audioWorklet.addModule(CaptureWorklet);

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
	}

	close() {
		this.signals.close();
		this.#track.close();
	}
}
