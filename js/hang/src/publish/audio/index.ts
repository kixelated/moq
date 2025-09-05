import * as Moq from "@kixelated/moq";
import { Effect, type Getter, Signal } from "@kixelated/signals";
import type * as Catalog from "../../catalog";
import { u8, u53 } from "../../catalog/integers";
import * as Frame from "../../frame";
import * as Time from "../../time";
import * as libav from "../../util/libav";
import { Captions, type CaptionsProps } from "./captions";
import type * as Capture from "./capture";

export * from "./captions";

const GAIN_MIN = 0.001;
const FADE_TIME = 0.2;

export type Source = AudioStreamTrack;

// Unfortunately, we need to use a Vite-exclusive import for now.
import CaptureWorklet from "./capture-worklet?worker&url";
import { Speaking, type SpeakingProps } from "./speaking";

export type AudioConstraints = Omit<
	MediaTrackConstraints,
	"aspectRatio" | "backgroundBlur" | "displaySurface" | "facingMode" | "frameRate" | "height" | "width"
>;

// Stronger typing for the MediaStreamTrack interface.
export interface AudioStreamTrack extends MediaStreamTrack {
	kind: "audio";
	clone(): AudioStreamTrack;
	getSettings(): AudioTrackSettings;
}

// MediaTrackSettings can represent both audio and video, which means a LOT of possibly undefined properties.
// This is a fork of the MediaTrackSettings interface with properties required for audio or video.
export interface AudioTrackSettings {
	deviceId: string;
	groupId: string;

	// Seems to be available on all browsers.
	sampleRate: number;

	// The rest is optional unfortunately.
	autoGainControl?: boolean;
	channelCount?: number; // ugh Safari why
	echoCancellation?: boolean;
	noiseSuppression?: boolean;
	sampleSize?: number;
}

// The initial values for our signals.
export type AudioProps = {
	enabled?: boolean | Signal<boolean>;
	source?: Source | Signal<Source | undefined>;

	muted?: boolean | Signal<boolean>;
	volume?: number | Signal<number>;
	captions?: CaptionsProps;
	speaking?: SpeakingProps;

	// The size of each group. Larger groups mean fewer drops but the viewer can fall further behind.
	// NOTE: Each frame is always flushed to the network immediately.
	maxLatency?: Time.Milli;
};

export class Audio {
	broadcast: Moq.BroadcastProducer;
	enabled: Signal<boolean>;

	muted: Signal<boolean>;
	volume: Signal<number>;
	captions: Captions;
	speaking: Speaking;
	maxLatency: Time.Milli;

	source: Signal<Source | undefined>;

	#catalog = new Signal<Catalog.Audio | undefined>(undefined);
	readonly catalog: Getter<Catalog.Audio | undefined> = this.#catalog;

	#config = new Signal<Catalog.AudioConfig | undefined>(undefined);
	readonly config: Getter<Catalog.AudioConfig | undefined> = this.#config;

	#worklet = new Signal<AudioWorkletNode | undefined>(undefined);

	#gain = new Signal<GainNode | undefined>(undefined);
	readonly root: Getter<AudioNode | undefined> = this.#gain;

	#track = new Moq.TrackProducer("audio", 1);

	#signals = new Effect();

	constructor(broadcast: Moq.BroadcastProducer, props?: AudioProps) {
		this.broadcast = broadcast;
		this.source = Signal.from(props?.source);
		this.enabled = Signal.from(props?.enabled ?? false);
		this.speaking = new Speaking(this, props?.speaking);
		this.captions = new Captions(this, props?.captions);
		this.muted = Signal.from(props?.muted ?? false);
		this.volume = Signal.from(props?.volume ?? 1);
		this.maxLatency = props?.maxLatency ?? (100 as Time.Milli); // Default is a group every 100ms

		this.#signals.effect(this.#runSource.bind(this));
		this.#signals.effect(this.#runGain.bind(this));
		this.#signals.effect(this.#runEncoder.bind(this));
		this.#signals.effect(this.#runCatalog.bind(this));
	}

	#runSource(effect: Effect): void {
		const enabled = effect.get(this.enabled);
		if (!enabled) return;

		const source = effect.get(this.source);
		if (!source) return;

		const settings = source.getSettings();

		const context = new AudioContext({
			latencyHint: "interactive",
			sampleRate: settings.sampleRate,
		});
		effect.cleanup(() => context.close());

		const root = new MediaStreamAudioSourceNode(context, {
			mediaStream: new MediaStream([source]),
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
				channelCount: settings.channelCount ?? root.channelCount,
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

		const source = effect.get(this.source);
		if (!source) return;

		const worklet = effect.get(this.#worklet);
		if (!worklet) return;

		const config = {
			// TODO get codec and description from decoderConfig
			codec: "opus",
			sampleRate: u53(worklet.context.sampleRate),
			numberOfChannels: u53(worklet.channelCount),
			// TODO configurable
			bitrate: u53(worklet.channelCount * 32_000),
			// TODO there's a bunch of advanced Opus settings that we should use.
		};

		let group: Moq.GroupProducer = this.#track.appendGroup();
		effect.cleanup(() => group.close());

		let groupTimestamp = 0 as Time.Micro;

		effect.spawn(async (cancel) => {
			// We're using an async polyfill temporarily for Safari support.
			const loaded = await Promise.race([libav.polyfill(), cancel]);
			if (!loaded) return; // cancelled

			const encoder = new AudioEncoder({
				output: (frame) => {
					if (frame.type !== "key") {
						throw new Error("only key frames are supported");
					}

					if (frame.timestamp - groupTimestamp >= Time.Micro.fromMilli(this.maxLatency)) {
						group.close();
						group = this.#track.appendGroup();
						groupTimestamp = frame.timestamp as Time.Micro;
					}

					const buffer = Frame.encode(frame, frame.timestamp as Time.Micro);
					group.writeFrame(buffer);
				},
				error: (err) => {
					console.error("encoder error", err);
					group.abort(err);
				},
			});
			effect.cleanup(() => encoder.close());

			encoder.configure(config);
			effect.set(this.#config, config);

			worklet.port.onmessage = ({ data }: { data: Capture.AudioFrame }) => {
				const channels = data.channels.slice(0, worklet.channelCount);
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
					timestamp: data.timestamp,
					data: joined,
					transfer: [joined.buffer],
				});

				encoder.encode(frame);
				frame.close();
			};
			effect.cleanup(() => {
				worklet.port.onmessage = null;
			});
		});
	}

	#runCatalog(effect: Effect): void {
		const config = effect.get(this.#config);
		if (!config) return;

		// Insert the track into the broadcast before returning the catalog referencing it.
		this.broadcast.insertTrack(this.#track.consume());
		effect.cleanup(() => this.broadcast.removeTrack(this.#track.name));

		const captions = effect.get(this.captions.catalog);
		const speaking = effect.get(this.speaking.catalog);

		const catalog: Catalog.Audio = {
			track: {
				name: this.#track.name,
				priority: u8(this.#track.priority),
			},
			config,
			captions,
			speaking,
		};

		effect.set(this.#catalog, catalog);
	}

	close() {
		this.#signals.close();
		this.captions.close();
		this.speaking.close();
		this.#track.close();
	}
}
