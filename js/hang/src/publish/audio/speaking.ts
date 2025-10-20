import * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import * as Catalog from "../../catalog";
import { PRIORITY } from "../priority";
import CaptureWorklet from "./capture-worklet?worker&url";
import type { Request, Result } from "./speaking-worker";
import type { Source } from "./types";

export type SpeakingProps = {
	enabled?: boolean | Signal<boolean>;
};

// Detects when the user is speaking.
export class Speaking {
	static readonly TRACK = "audio/speaking.bool";
	static readonly PRIORITY = PRIORITY.speaking;

	source: Signal<Source | undefined>;

	enabled: Signal<boolean>;

	active = new Signal<boolean>(false);
	catalog = new Signal<Catalog.Speaking | undefined>(undefined);

	signals = new Effect();

	constructor(source: Signal<Source | undefined>, props?: SpeakingProps) {
		this.source = source;
		this.enabled = Signal.from(props?.enabled ?? false);
		this.signals.effect(this.#runCatalog.bind(this));
	}

	#runCatalog(effect: Effect): void {
		console.log("run catalog", effect.get(this.enabled));

		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		// TODO only run the worker if there's a subscriber
		// The current API requires we update the active signal, but maybe nobody cares.
		const source = effect.get(this.source);
		if (!source) return;

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

		const catalog: Catalog.Speaking = {
			track: {
				name: Speaking.TRACK,
				priority: Speaking.PRIORITY,
			},
		};
		effect.set(this.catalog, catalog);
	}

	serve(track: Moq.Track, effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const source = effect.get(this.source);
		if (!source) return;

		const active = effect.get(this.active);
		track.writeBool(active);
	}

	close() {
		this.signals.close();
	}
}
