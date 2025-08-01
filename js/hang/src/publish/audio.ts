import * as Moq from "@kixelated/moq";
import { type Computed, type Effect, Root, Signal } from "@kixelated/signals";
import type * as Catalog from "../catalog";
import { u8, u53 } from "../catalog/integers";
import * as Container from "../container";
import type { VAD } from "../worker";
import VAD_WORKER_URL from "../worker/vad?worker&url";
import type * as Worklet from "../worklet";
import WORKLET_URL from "../worklet/capture?worker&url";

// Create a group every half a second
const GOP_DURATION = 0.5;

const GAIN_MIN = 0.001;
const FADE_TIME = 0.2;

export type AudioConstraints = Omit<
	MediaTrackConstraints,
	"aspectRatio" | "backgroundBlur" | "displaySurface" | "facingMode" | "frameRate" | "height" | "width"
>;

// Stronger typing for the MediaStreamTrack interface.
export interface AudioTrack extends MediaStreamTrack {
	kind: "audio";
	clone(): AudioTrack;
}

// MediaTrackSettings can represent both audio and video, which means a LOT of possibly undefined properties.
// This is a fork of the MediaTrackSettings interface with properties required for audio or vidfeo.
export interface AudioTrackSettings {
	deviceId: string;
	groupId: string;

	autoGainControl: boolean;
	channelCount: number;
	echoCancellation: boolean;
	noiseSuppression: boolean;
	sampleRate: number;
	sampleSize: number;
}

export type AudioProps = {
	enabled?: boolean;
	media?: AudioTrack;
	constraints?: AudioConstraints;

	muted?: boolean;
	volume?: number;
	vad?: boolean;
};

export class Audio {
	broadcast: Moq.BroadcastProducer;
	enabled: Signal<boolean>;

	muted: Signal<boolean>;
	volume: Signal<number>;
	vad: Signal<boolean>;

	// Set by VAD when it detects speech. undefined when VAD is disabled.
	speaking = new Signal<boolean | undefined>(undefined);

	media: Signal<AudioTrack | undefined>;
	constraints: Signal<AudioConstraints | undefined>;

	#catalog = new Signal<Catalog.Audio | undefined>(undefined);
	readonly catalog = this.#catalog.readonly();

	#worklet = new Signal<AudioWorkletNode | undefined>(undefined);

	#gain = new Signal<GainNode | undefined>(undefined);
	// Downcast to AudioNode so it matches Watch.
	readonly root = this.#gain.readonly() as Computed<AudioNode | undefined>;

	#vadWorker = new Signal<Worker | undefined>(undefined);

	#group?: Moq.GroupProducer;
	#groupTimestamp = 0;

	#id = 0;
	#signals = new Root();

	constructor(broadcast: Moq.BroadcastProducer, props?: AudioProps) {
		this.broadcast = broadcast;
		this.media = new Signal(props?.media);
		this.enabled = new Signal(props?.enabled ?? false);
		this.constraints = new Signal(props?.constraints);
		this.muted = new Signal(props?.muted ?? false);
		this.volume = new Signal(props?.volume ?? 1);
		this.vad = new Signal(props?.vad ?? false);

		this.#signals.effect(this.#runSource.bind(this));
		this.#signals.effect(this.#runGain.bind(this));
		this.#signals.effect(this.#runEncoder.bind(this));
		this.#signals.effect(this.#runVadWorker.bind(this));
		this.#signals.effect(this.#runVad.bind(this));
	}

	#runSource(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		const media = effect.get(this.media);
		if (!enabled || !media) return;

		const settings = media.getSettings();
		if (!settings) {
			throw new Error("track has no settings");
		}

		const context = new AudioContext({
			sampleRate: settings.sampleRate,
		});
		effect.cleanup(() => context.close());

		const root = new MediaStreamAudioSourceNode(context, {
			mediaStream: new MediaStream([media]),
		});
		effect.cleanup(() => root.disconnect());

		const gain = new GainNode(context, {
			gain: this.volume.peek(),
		});
		root.connect(gain);
		effect.cleanup(() => gain.disconnect());

		// Async because we need to wait for the worklet to be registered.
		context.audioWorklet.addModule(WORKLET_URL).then(() => {
			const worklet = new AudioWorkletNode(context, "capture", {
				numberOfInputs: 1,
				numberOfOutputs: 0,
				channelCount: settings.channelCount,
			});

			effect.set(this.#worklet, worklet);

			gain.connect(worklet);
			effect.cleanup(() => worklet.disconnect());

			// Only set the gain after the worklet is registered.
			effect.set(this.#gain, gain);
		});
	}

	#runGain(effect: Effect): void {
		const gain = effect.get(this.#gain);
		if (!gain) return;

		effect.cleanup(() => gain.gain.cancelScheduledValues(gain.context.currentTime));

		const volume = effect.get(this.muted) ? 0 : effect.get(this.volume);
		if (volume < GAIN_MIN) {
			gain.gain.exponentialRampToValueAtTime(GAIN_MIN, gain.context.currentTime + FADE_TIME);
			gain.gain.setValueAtTime(0, gain.context.currentTime + FADE_TIME + 0.01);
		} else {
			gain.gain.exponentialRampToValueAtTime(volume, gain.context.currentTime + FADE_TIME);
		}
	}

	#runEncoder(effect: Effect): void {
		if (!effect.get(this.enabled)) return;

		const media = effect.get(this.media);
		if (!media) return;

		const worklet = effect.get(this.#worklet);
		if (!worklet) return;

		const track = new Moq.TrackProducer(`audio-${this.#id++}`, 1);
		effect.cleanup(() => track.close());

		this.broadcast.insertTrack(track.consume());
		effect.cleanup(() => this.broadcast.removeTrack(track.name));

		const settings = media.getSettings() as AudioTrackSettings;

		const catalog = {
			track: {
				name: track.name,
				priority: u8(track.priority),
			},
			config: {
				// TODO get codec and description from decoderConfig
				codec: "opus",
				// Firefox doesn't provide the sampleRate in the settings.
				sampleRate: u53(settings.sampleRate ?? worklet?.context.sampleRate),
				numberOfChannels: u53(settings.channelCount),
				// TODO configurable
				bitrate: u53(settings.channelCount * 32_000),
			},
		};

		effect.set(this.#catalog, catalog);

		const encoder = new AudioEncoder({
			output: (frame) => {
				if (frame.type !== "key") {
					throw new Error("only key frames are supported");
				}

				if (!this.#group || frame.timestamp - this.#groupTimestamp >= 1000 * 1000 * GOP_DURATION) {
					this.#group?.close();
					this.#group = track.appendGroup();
					this.#groupTimestamp = frame.timestamp;
				}

				const buffer = Container.encodeFrame(frame, frame.timestamp);
				this.#group.writeFrame(buffer);
			},
			error: (err) => {
				this.#group?.abort(err);
				this.#group = undefined;

				track.abort(err);
			},
		});
		effect.cleanup(() => encoder.close());

		const config = catalog.config;

		encoder.configure({
			codec: config.codec,
			numberOfChannels: config.numberOfChannels,
			sampleRate: config.sampleRate,
			bitrate: config.bitrate,
		});

		worklet.port.onmessage = ({ data }: { data: Worklet.AudioFrame }) => {
			const channels = data.channels.slice(0, settings.channelCount);
			const joinedLength = channels.reduce((a, b) => a + b.length, 0);
			const joined = new Float32Array(joinedLength);

			channels.reduce((offset: number, channel: Float32Array): number => {
				joined.set(channel, offset);
				return offset + channel.length;
			}, 0);

			const frame = new AudioData({
				format: "f32-planar",
				sampleRate: worklet.context.sampleRate,
				numberOfFrames: channels[0].length,
				numberOfChannels: channels.length,
				timestamp: (1_000_000 * data.timestamp) / worklet.context.sampleRate,
				data: joined,
				transfer: [joined.buffer],
			});

			encoder.encode(frame);
			frame.close();
		};
	}

	#runVadWorker(effect: Effect): void {
		if (!effect.get(this.vad)) return;

		// Create and initialize VAD worker as soon as VAD is enabled
		const vadWorker = new Worker(VAD_WORKER_URL, { type: "module" });
		effect.cleanup(() => vadWorker.terminate());

		// Store the worker for use in #runVad
		effect.set(this.#vadWorker, vadWorker);
	}

	#runVad(effect: Effect): void {
		effect.cleanup(() => this.speaking.set(undefined));

		const worker = effect.get(this.#vadWorker);
		if (!worker) return;

		const media = effect.get(this.media);
		if (!media) return;

		const context = new AudioContext({
			sampleRate: 16000, // required by the model.
		});
		effect.cleanup(() => context.close());

		// Handle messages from the VAD worker
		worker.onmessage = ({ data }: MessageEvent<VAD.Response>) => {
			if (data.type === "result") {
				// Use heuristics to determine if we've toggled speaking or not
				this.speaking.set(data.speaking);
			} else if (data.type === "error") {
				console.error("VAD worker error:", data.message);
				this.speaking.set(undefined);
			}
		};

		// Start the worklet asynchronously.
		effect.spawn(async () => {
			// Async because we need to wait for the worklet to be registered.
			await context.audioWorklet.addModule(WORKLET_URL);

			const worklet = new AudioWorkletNode(context, "capture", {
				numberOfInputs: 1,
				numberOfOutputs: 0,
				channelCount: 1,
				channelCountMode: "explicit",
				channelInterpretation: "discrete",
			});

			const root = new MediaStreamAudioSourceNode(context, {
				mediaStream: new MediaStream([media]),
			});
			effect.cleanup(() => root.disconnect());

			root.connect(worklet);
			effect.cleanup(() => worklet.disconnect());

			// Sent the worklet to the VAD worker, so the main thread doesn't have to be involved.
			worker.postMessage(
				{
					type: "init",
					worklet: worklet.port,
				},
				[worklet.port],
			);
		});
	}

	close() {
		this.#signals.close();
	}
}
