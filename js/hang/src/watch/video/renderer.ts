import { Effect, Signal } from "@kixelated/signals";
import type { Source } from "./source";

export type RendererProps = {
	canvas?: HTMLCanvasElement | Signal<HTMLCanvasElement | undefined>;
	paused?: boolean | Signal<boolean>;
};

// An component to render a video to a canvas.
export class Renderer {
	source: Source;

	// The canvas to render the video to.
	canvas: Signal<HTMLCanvasElement | undefined>;

	// Whether the video is paused.
	paused: Signal<boolean>;

	#animate?: number;

	#ctx = new Signal<CanvasRenderingContext2D | undefined>(undefined);
	#signals = new Effect();

	constructor(source: Source, props?: RendererProps) {
		this.source = source;
		this.canvas = Signal.from(props?.canvas);
		this.paused = Signal.from(props?.paused ?? false);

		this.#signals.effect((effect) => {
			const canvas = effect.get(this.canvas);
			this.#ctx.set(canvas?.getContext("2d") ?? undefined);
		});

		this.#signals.effect(this.#schedule.bind(this));
		this.#signals.effect(this.#runEnabled.bind(this));

		this.#signals.effect((effect) => {
			const canvas = effect.get(this.canvas);
			if (!canvas) return;

			const active = effect.get(this.source.active);
			if (active) {
				// Initialize the canvas to the correct size.
				// NOTE: each frame will resize the canvas, so this is mostly to avoid pop-in.
				canvas.width = active.config.displayAspectWidth ?? active.config.codedWidth ?? 1;
				canvas.height = active.config.displayAspectHeight ?? active.config.codedHeight ?? 1;
			} else {
				// We want at least 1x1 so we can detect if the canvas is hidden.
				canvas.width = 1;
				canvas.height = 1;
			}
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

		const frame = this.source.frame.peek();
		if (frame) {
			const w = frame.displayWidth;
			const h = frame.displayHeight;
			if (ctx.canvas.width !== w || ctx.canvas.height !== h) {
				ctx.canvas.width = w;
				ctx.canvas.height = h;
			}

			// Prepare background and transformations for this draw
			ctx.save();
			ctx.fillStyle = "#000";
			ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

			// Apply horizontal flip if specified in the video config
			const flip = this.source.active.peek()?.config.flip;
			if (flip) {
				ctx.scale(-1, 1);
				ctx.translate(-ctx.canvas.width, 0);
			}

			ctx.drawImage(frame, 0, 0, ctx.canvas.width, ctx.canvas.height);
			ctx.restore();
		} else {
			// Clear canvas when no frame
			ctx.fillStyle = "#000";
			ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
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
