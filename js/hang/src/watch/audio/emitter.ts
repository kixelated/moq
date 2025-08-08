import { Effect, Signal } from "@kixelated/signals";
import type { Audio } from ".";

const MIN_GAIN = 0.001;
const FADE_TIME = 0.2;

export type AudioEmitterProps = {
	volume?: number;
	muted?: boolean;
	paused?: boolean;
};

// A helper that emits audio directly to the speakers.
export class AudioEmitter {
	source: Audio;
	volume: Signal<number>;
	muted: Signal<boolean>;

	// Similar to muted, but controls whether we download audio at all.
	// That way we can be "muted" but also download audio for visualizations.
	paused: Signal<boolean>;

	#signals = new Effect();

	// The volume to use when unmuted.
	#unmuteVolume = 0.5;

	// The gain node used to adjust the volume.
	#gain = new Signal<GainNode | undefined>(undefined);

	constructor(source: Audio, props?: AudioEmitterProps) {
		this.source = source;
		this.volume = new Signal(props?.volume ?? 0.5);
		this.muted = new Signal(props?.muted ?? false);
		this.paused = new Signal(props?.paused ?? props?.muted ?? false);

		// Set the volume to 0 when muted.
		this.#signals.effect((effect) => {
			const muted = effect.get(this.muted);
			if (muted) {
				this.#unmuteVolume = this.volume.peek() || 0.5;
				this.volume.set(0);
				this.source.enabled.set(false);
			} else {
				this.volume.set(this.#unmuteVolume);
				this.source.enabled.set(true);
			}
		});

		// Set unmute when the volume is non-zero.
		this.#signals.effect((effect) => {
			const volume = effect.get(this.volume);
			this.muted.set(volume === 0);
		});

		this.#signals.effect((effect) => {
			const root = effect.get(this.source.root);
			if (!root) return;

			const gain = new GainNode(root.context, { gain: effect.get(this.volume) });
			root.connect(gain);

			gain.connect(root.context.destination); // speakers
			effect.cleanup(() => gain.disconnect());

			effect.set(this.#gain, gain);
		});

		this.#signals.effect((effect) => {
			const gain = effect.get(this.#gain);
			if (!gain) return;

			// Cancel any scheduled transitions on change.
			effect.cleanup(() => gain.gain.cancelScheduledValues(gain.context.currentTime));

			const volume = effect.get(this.volume);
			if (volume < MIN_GAIN) {
				gain.gain.exponentialRampToValueAtTime(MIN_GAIN, gain.context.currentTime + FADE_TIME);
				gain.gain.setValueAtTime(0, gain.context.currentTime + FADE_TIME + 0.01);
			} else {
				gain.gain.exponentialRampToValueAtTime(volume, gain.context.currentTime + FADE_TIME);
			}
		});

		this.#signals.effect((effect) => {
			this.source.enabled.set(!effect.get(this.paused));
		});
	}

	close() {
		this.#signals.close();
	}
}
