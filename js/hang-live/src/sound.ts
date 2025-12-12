import { Effect, Signal } from "@moq/signals";
import Settings from "./settings";

const FADE_TIME = 0.2;
const GAIN_MIN = 0.001;

export type SoundProps = {
	enabled?: boolean | Signal<boolean>;
};

const RESUME_EVENTS = ["click", "touchstart", "touchend", "mousedown", "keydown"];

export class Sound {
	enabled: Signal<boolean>;

	context: AudioContext;
	gain: GainNode;
	suspended: Signal<boolean>;

	#signals = new Effect();

	constructor(props?: SoundProps) {
		this.context = new AudioContext({
			latencyHint: "playback",
		});
		this.suspended = new Signal(this.context.state === "suspended");

		// Try to initialize the audio context if it's suspended.
		if (this.suspended.peek()) {
			// Listen for any events that might let us unmute the audio context.
			for (const event of RESUME_EVENTS) {
				document.addEventListener(
					event,
					() => this.context.resume().then(() => this.suspended.set(this.context.state === "suspended")),
					{ once: true },
				);
			}
		}

		this.enabled = Signal.from(props?.enabled ?? false);

		this.gain = new GainNode(this.context);
		this.gain.connect(this.context.destination);

		this.#signals.effect(this.#runGain.bind(this));
	}

	#runGain(effect: Effect) {
		// Reduce the volume for notifications so we can hear them over everything else.
		const volume = effect.get(this.enabled) ? effect.get(Settings.audio.volume) / 2 : 0;

		// Cancel any scheduled transitions on change.
		effect.cleanup(() => this.gain.gain.cancelScheduledValues(this.gain.context.currentTime));

		if (volume < GAIN_MIN) {
			this.gain.gain.exponentialRampToValueAtTime(GAIN_MIN, this.gain.context.currentTime + FADE_TIME);
			this.gain.gain.setValueAtTime(0, this.gain.context.currentTime + FADE_TIME + 0.01);
		} else {
			this.gain.gain.exponentialRampToValueAtTime(volume, this.gain.context.currentTime + FADE_TIME);
		}
	}

	media(element: HTMLAudioElement | HTMLVideoElement): MediaElementAudioSourceNode {
		const source = new MediaElementAudioSourceNode(this.context, { mediaElement: element });
		source.connect(this.gain);
		return source;
	}

	async load(url: string): Promise<AudioBuffer> {
		const response = await fetch(url);
		const data = await response.arrayBuffer();
		return await this.context.decodeAudioData(data);
	}

	close() {
		this.context.close().catch(() => {});
		this.gain.disconnect();
		this.#signals.close();
	}
}

export class PannedSound {
	parent: Sound;
	#panner: StereoPannerNode;

	// Optional, disabled in potato mode.
	analyser?: AnalyserNode;
	#buffer = new Uint8Array(1024);

	pan: Signal<number>;

	#signals = new Effect();

	constructor(parent: Sound, pan: Signal<number>) {
		this.parent = parent;

		this.#panner = new StereoPannerNode(parent.context);
		this.#panner.connect(parent.gain);

		this.pan = pan;

		// Always create the analyser
		const analyser = new AnalyserNode(this.parent.context, { fftSize: this.#buffer.length });
		this.#panner.connect(analyser);
		this.analyser = analyser;

		this.#signals.effect((effect) => {
			effect.cleanup(() => this.#panner.pan.cancelScheduledValues(this.#panner.context.currentTime));

			const pan = Math.max(-1, Math.min(1, effect.get(this.pan) * 2));
			this.#panner.pan.linearRampToValueAtTime(pan, this.#panner.context.currentTime + FADE_TIME);
		});
	}

	media(element: HTMLAudioElement | HTMLVideoElement): MediaElementAudioSourceNode {
		const source = new MediaElementAudioSourceNode(this.parent.context, { mediaElement: element });
		source.connect(this.#panner);
		return source;
	}

	async load(url: string): Promise<AudioBufferSourceNode> {
		const response = await fetch(url);
		const data = await response.arrayBuffer();
		const buffer = await this.parent.context.decodeAudioData(data);
		const node = new AudioBufferSourceNode(this.parent.context, { buffer });
		node.connect(this.#panner);
		node.start();
		return node;
	}

	// NOTE: The buffer is reused, so don't hold on to it.
	analyze(): Uint8Array | undefined {
		if (!this.analyser) return undefined;
		this.analyser.getByteTimeDomainData(this.#buffer);
		return this.#buffer;
	}

	close() {
		this.#signals.close();
		this.#panner.disconnect();
		this.analyser?.disconnect();
	}
}
