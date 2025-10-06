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

		this.#signals.effect(this.#runEnabled.bind(this));
		this.#signals.effect(this.#runRender.bind(this));
		this.#signals.effect(this.#runResize.bind(this));
	}

	#runResize(effect: Effect) {
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
	}

	// Detect when video should be downloaded.
	#runEnabled(effect: Effect): void {
		const canvas = effect.get(this.canvas);
		if (!canvas) return;

		const paused = effect.get(this.paused);
		if (paused) return;

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

	#runRender(effect: Effect) {
		const ctx = effect.get(this.#ctx);
		if (!ctx) return;

		const paused = effect.get(this.paused);
		if (paused) return;

		const frame = effect.get(this.source.frame)?.clone();

		// Request a callback to render the frame based on the monitor's refresh rate.
		let animate: number | undefined = requestAnimationFrame(() => {
			this.#render(ctx, frame);
			animate = undefined;
		});

		// Clean up the frame and any pending animation request.
		effect.cleanup(() => {
			// NOTE: Closing this frame is the only reason we don't use `effect.animate`.
			// It's slighly more efficient to use one .cleanup() callback instead of two.
			frame?.close();
			if (animate) cancelAnimationFrame(animate);
		});
	}

	#render(ctx: CanvasRenderingContext2D, frame?: VideoFrame) {
		if (!frame) {
			// Clear canvas when no frame
			ctx.fillStyle = "#000";
			ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
			return;
		}

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
	}

	// Close the track and all associated resources.
	close() {
		this.#signals.close();
	}
}
