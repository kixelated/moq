import { Effect, Signal } from "@kixelated/signals";
import type { Video } from ".";

export type VideoRendererProps = {
	canvas?: HTMLCanvasElement;
	paused?: boolean;
};

// An component to render a video to a canvas.
export class VideoRenderer {
	// The source of video frames, also responsible for switching between video tracks.
	source: Video;

	// The canvas to render the video to.
	canvas: Signal<HTMLCanvasElement | undefined>;

	// Whether the video is paused.
	paused: Signal<boolean>;

	#animate?: number;

	#ctx = new Signal<CanvasRenderingContext2D | undefined>(undefined);
	#signals = new Effect();

	constructor(source: Video, props?: VideoRendererProps) {
		this.source = source;
		this.canvas = new Signal(props?.canvas);
		this.paused = new Signal(props?.paused ?? false);

		this.#signals.effect((effect) => {
			const canvas = effect.get(this.canvas);
			this.#ctx.set(canvas?.getContext("2d", { desynchronized: true }) ?? undefined);
		});

		this.#signals.effect(this.#schedule.bind(this));
		this.#signals.effect(this.#runEnabled.bind(this));

		this.#signals.effect((effect) => {
			const canvas = effect.get(this.canvas);
			if (!canvas) return;

			const enabled = effect.get(this.source.enabled);
			if (enabled) return;

			// Shrink the canvas when the video is disabled.
			canvas.width = 0;
			canvas.height = 0;
		});
	}

	// Detect when video should be downloaded.
	#runEnabled(effect: Effect): void {
		const canvas = effect.get(this.canvas);
		if (!canvas) return;

		const paused = effect.get(this.paused);
		if (paused) return;

		this.#schedule();

		// Detect when the canvas is not visible.
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					this.source.enabled.set(entry.isIntersecting);
				}
			},
			{
				// fire when even a small part is visible
				threshold: 0.01,
			},
		);

		effect.cleanup(() => this.source.enabled.set(false));

		observer.observe(canvas);
		effect.cleanup(() => observer.disconnect());
	}

	// (re)schedule a render maybe.
	#schedule() {
		const ctx = this.#ctx.peek();
		const paused = this.paused.peek();

		if (ctx && !paused) {
			if (!this.#animate) {
				this.#animate = requestAnimationFrame(this.#render.bind(this));
			}
		} else {
			if (this.#animate) {
				cancelAnimationFrame(this.#animate);
				this.#animate = undefined;
			}
		}
	}

	#render() {
		// Schedule the next render.
		this.#animate = undefined;
		this.#schedule();

		const ctx = this.#ctx.peek();
		if (!ctx) {
			throw new Error("scheduled without a canvas");
		}

		ctx.save();
		ctx.fillStyle = "#000";
		ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

		const frame = this.source.frame.peek();
		if (frame) {
			ctx.canvas.width = frame.displayWidth;
			ctx.canvas.height = frame.displayHeight;
			ctx.drawImage(frame, 0, 0, ctx.canvas.width, ctx.canvas.height);
		}

		// Draw a loading icon when the lag 2+ seconds
		// TODO expose this as a signal
		/*
		const spinner = Math.min(Math.max(((lag ?? 0) - 2000) / (4000 - 2000), 0), 1);
		if (spinner > 0) {
			const spinnerSize = 64;
			const spinnerX = ctx.canvas.width / 2 - spinnerSize / 2;
			const spinnerY = ctx.canvas.height / 2 - spinnerSize / 2;
			const angle = ((now % 1000) / 1000) * 2 * Math.PI;

			ctx.save();
			ctx.translate(spinnerX + spinnerSize / 2, spinnerY + spinnerSize / 2);
			ctx.rotate(angle);

			ctx.beginPath();
			ctx.arc(0, 0, spinnerSize / 2 - 2, 0, Math.PI * 1.5); // crude 3/4 arc
			ctx.lineWidth = 8;
			ctx.strokeStyle = `rgba(255, 255, 255, ${spinner})`;
			ctx.stroke();

			ctx.restore();
		}
		*/

		ctx.restore();
	}

	// Close the track and all associated resources.
	close() {
		this.#signals.close();

		if (this.#animate) {
			cancelAnimationFrame(this.#animate);
			this.#animate = undefined;
		}
	}
}
