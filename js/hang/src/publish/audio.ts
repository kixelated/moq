import * as Moq from "@kixelated/moq";
import { Computed, Effect, Root, Signal } from "@kixelated/signals";
import * as Catalog from "../catalog";
import * as Container from "../container";

// Create a group every half a second
const GOP_DURATION = 0.5;

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
};

export class Audio {
	broadcast: Moq.BroadcastProducer;
	enabled: Signal<boolean>;

	readonly media: Signal<AudioTrack | undefined>;
	readonly constraints: Signal<AudioConstraints | undefined>;

	#catalog = new Signal<Catalog.Audio | undefined>(undefined);
	readonly catalog = this.#catalog.readonly();

	#worklet = new Signal<AudioWorkletNode | undefined>(undefined);

	// Expose the root of the audio graph so we can use it for custom visualizations.
	#root = new Signal<MediaStreamAudioSourceNode | undefined>(undefined);
	// Downcast to AudioNode so it matches Watch.
	readonly root = this.#root.readonly() as Computed<AudioNode | undefined>;

	#group?: Moq.GroupProducer;
	#groupTimestamp = 0;

	#id = 0;
	#signals = new Root();

	constructor(broadcast: Moq.BroadcastProducer, props?: AudioProps) {
		this.broadcast = broadcast;
		this.media = new Signal(props?.media);
		this.enabled = new Signal(props?.enabled ?? false);
		this.constraints = new Signal(props?.constraints);

		this.#signals.effect(this.#initWorklet.bind(this));
		this.#signals.effect(this.#runEncoder.bind(this));
	}

	#initWorklet(effect: Effect): void {
		if (!effect.get(this.enabled)) return;

		const media = effect.get(this.media);
		if (!media) return;

		const settings = media.getSettings();
		if (!settings) {
			throw new Error("track has no settings");
		}

		const context = new AudioContext({
			sampleRate: settings.sampleRate,
		});
		effect.cleanup(() => context.close());

		const root = new MediaStreamAudioSourceNode(context, { mediaStream: new MediaStream([media]) });

		this.#root.set(root);
		effect.cleanup(() => this.#root.set(undefined));

		// Async because we need to wait for the worklet to be registered.
		// Annoying, I know...
		context.audioWorklet.addModule(`data:text/javascript,(${worklet.toString()})()`).then(() => {
			const worklet = new AudioWorkletNode(context, "capture");
			this.#worklet.set(worklet);

			root.connect(worklet);
			effect.cleanup(() => worklet.disconnect());
		});
	}

	#runEncoder(effect: Effect): void {
		if (!effect.get(this.enabled)) return;

		const worklet = effect.get(this.#worklet);
		if (!worklet) return;

		const media = effect.get(this.media);
		if (!media) return;

		const track = new Moq.TrackProducer(`audio-${this.#id++}`, 1);
		this.broadcast.insertTrack(track.consume());

		effect.cleanup(() => track.close());
		effect.cleanup(() => this.broadcast.removeTrack(track.name));

		const settings = media.getSettings() as AudioTrackSettings;

		// TODO: This is a Firefox hack to get the sample rate.
		const sampleRate =
			settings.sampleRate ??
			(() => {
				const ctx = new AudioContext();
				const rate = ctx.sampleRate;
				ctx.close();
				return rate;
			})();

		const catalog = {
			track: {
				name: track.name,
				priority: track.priority,
			},
			config: {
				// TODO get codec and description from decoderConfig
				codec: "opus",
				sampleRate,
				numberOfChannels: settings.channelCount,
				// TODO configurable
				bitrate: 64_000,
			},
		};

		this.#catalog.set(catalog);
		effect.cleanup(() => this.#catalog.set(undefined));

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

		worklet.port.addEventListener("message", ({ data: channels }: { data: Float32Array[] }) => {
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
				timestamp: (worklet.context.currentTime * 1e6) | 0,
				data: joined,
				transfer: [joined.buffer],
			});

			encoder.encode(frame);
			frame.close();
		});
	}

	close() {
		this.#signals.close();
	}
}

function worklet() {
	// @ts-expect-error Would need a separate file/tsconfig to get this to work.
	registerProcessor(
		"capture",
		// @ts-expect-error Would need a separate tsconfig to get this to work.
		class Processor extends AudioWorkletProcessor {
			process(input: Float32Array[][]) {
				// @ts-expect-error Would need a separate tsconfig to get this to work.
				this.port.postMessage(input[0]);
				return true;
			}
		},
	);
}
