import * as Moq from "@kixelated/moq";
import { Effect, type Getter, Signal } from "@kixelated/signals";
import type * as Catalog from "../catalog";
import { u8, u53 } from "../catalog/integers";
import * as Container from "../container";
import type { Transcribe, VAD } from "../worker";
import type * as Worklet from "../worklet";

// Create a group every half a second
const GOP_DURATION = 0.5;

const GAIN_MIN = 0.001;
const FADE_TIME = 0.2;

// TODO Make this configurable.
const CAPTION_TTL = 1000 * 5;

// Unfortunately, we need to use a Vite-exclusive import for now.
import CaptureWorklet from "../worklet/capture?worker&url";

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

// The initial values for our signals.
export type AudioProps = {
	enabled?: boolean;
	media?: AudioTrack;
	constraints?: AudioConstraints;

	muted?: boolean;
	volume?: number;
	vad?: boolean;
	transcribe?: boolean;
};

export class Audio {
	broadcast: Moq.BroadcastProducer;
	enabled: Signal<boolean>;

	muted: Signal<boolean>;
	volume: Signal<number>;

	// Enable Voice Activity Detection (VAD) via an on-device model.
	// This will publish a "captions" track and toggle the `speaking` signal between true/false.
	vad: Signal<boolean>;
	speaking = new Signal<boolean | undefined>(undefined);

	// Enable caption generation via an on-device model (whisper).
	// This will publish a "captions" track and set the `caption` signal.
	transcribe: Signal<boolean>;
	caption = new Signal<string | undefined>(undefined);
	#captionTrack = new Signal<Moq.TrackProducer | undefined>(undefined);

	media: Signal<AudioTrack | undefined>;
	constraints: Signal<AudioConstraints | undefined>;

	#catalog = new Signal<Catalog.Audio | undefined>(undefined);
	readonly catalog: Getter<Catalog.Audio | undefined> = this.#catalog;

	#worklet = new Signal<AudioWorkletNode | undefined>(undefined);

	#gain = new Signal<GainNode | undefined>(undefined);
	readonly root: Getter<AudioNode | undefined> = this.#gain;

	#group?: Moq.GroupProducer;
	#groupTimestamp = 0;

	#id = 0;
	#signals = new Effect();

	// Initialize the workers as soon as they are enabled, even before any media is selected.
	// This is done because the first thing they do is load a massive model and we want to front-load that work.
	#workers = new Signal<
		| {
				vad: Worker;
				transcribe?: Worker;
		  }
		| undefined
	>(undefined);

	constructor(broadcast: Moq.BroadcastProducer, props?: AudioProps) {
		this.broadcast = broadcast;
		this.media = new Signal(props?.media);
		this.enabled = new Signal(props?.enabled ?? false);
		this.constraints = new Signal(props?.constraints);
		this.muted = new Signal(props?.muted ?? false);
		this.volume = new Signal(props?.volume ?? 1);
		this.vad = new Signal(props?.vad ?? false);
		this.transcribe = new Signal(props?.transcribe ?? false);

		this.#signals.effect(this.#runSource.bind(this));
		this.#signals.effect(this.#runGain.bind(this));
		this.#signals.effect(this.#runEncoder.bind(this));
		this.#signals.effect(this.#loadWorkers.bind(this));
		this.#signals.effect(this.#runVad.bind(this));
		this.#signals.effect(this.#runCaption.bind(this));
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
		effect.spawn(async () => {
			await context.audioWorklet.addModule(CaptureWorklet);
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

		// TODO don't reininalize the encoder just because the captions track changed.
		const captions = effect.get(this.#captionTrack);

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
			caption: captions
				? {
						name: captions.name,
						priority: u8(captions.priority),
					}
				: undefined,
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

	// Start loading the VAD worker and transcribe worker as soon as they are enabled, even before any media is selected.
	#loadWorkers(effect: Effect): void {
		if (!effect.get(this.vad) && !effect.get(this.transcribe)) return;

		const vad = new Worker(new URL("../worker/vad", import.meta.url), { type: "module" });
		effect.cleanup(() => vad.terminate());

		// Handle messages from the VAD worker
		vad.onmessage = ({ data }: MessageEvent<VAD.Response>) => {
			if (data.type === "result") {
				// Use heuristics to determine if we've toggled speaking or not
				this.speaking.set(data.speaking);
			} else if (data.type === "error") {
				console.error("VAD worker error:", data.message);
				this.speaking.set(undefined);
			}
		};
		effect.cleanup(() => this.speaking.set(undefined));

		let transcribe: Worker | undefined;
		if (effect.get(this.transcribe)) {
			// I could start loading the Worker before the worklet but eh I'm lazy.
			transcribe = new Worker(new URL("../worker/transcribe", import.meta.url), { type: "module" });
			effect.cleanup(() => transcribe?.terminate());

			let timeout: ReturnType<typeof setTimeout> | undefined;
			effect.cleanup(() => clearTimeout(timeout));

			transcribe.onmessage = ({ data }: MessageEvent<Transcribe.Response>) => {
				if (data.type === "result") {
					this.caption.set(data.text);

					clearTimeout(timeout);
					timeout = setTimeout(() => this.caption.set(undefined), CAPTION_TTL);
				} else if (data.type === "error") {
					console.error("Transcribe worker error:", data.message);
				}
			};
			effect.cleanup(() => this.caption.set(undefined));
		}

		effect.set(this.#workers, { vad, transcribe });
	}

	#runVad(effect: Effect): void {
		const workers = effect.get(this.#workers);
		if (!workers) return;

		const media = effect.get(this.media);
		if (!media) return;

		// Unset the caption and speaking signals when media is disconnected.
		effect.cleanup(() => {
			this.speaking.set(undefined);
			this.caption.set(undefined);
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

			if (!workers.transcribe) {
				workers.vad.postMessage(
					{
						type: "init",
						worklet: worklet.port,
					},
					[worklet.port],
				);
			} else {
				const pipe = new MessageChannel();
				workers.vad.postMessage(
					{
						type: "init",
						transcribe: pipe.port1,
						worklet: worklet.port,
					},
					[worklet.port, pipe.port1],
				);

				workers.transcribe.postMessage(
					{
						type: "init",
						vad: pipe.port2,
					},
					[pipe.port2],
				);
			}
		});
	}

	#runCaption(effect: Effect): void {
		if (!effect.get(this.transcribe)) return;

		const track = new Moq.TrackProducer(`captions-${this.#id++}`, 1);
		effect.cleanup(() => track.close());

		this.broadcast.insertTrack(track.consume());
		effect.cleanup(() => this.broadcast.removeTrack(track.name));

		effect.set(this.#captionTrack, track);

		// Create a nested effect to avoid recreating the track every time the caption changes.
		effect.effect((nested) => {
			const text = nested.get(this.caption) ?? "";
			track.appendFrame(new TextEncoder().encode(text));
		});
	}

	close() {
		this.#signals.close();
	}
}
