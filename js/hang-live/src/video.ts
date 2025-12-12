import { type Effect, Signal } from "@moq/signals";
import type { Broadcast } from "./broadcast";
import { Vector } from "./geometry";
import Settings from "./settings";

//export type VideoSource = Watch.Video.Source | Publish.Video.Encoder;

export class Video {
	// We don't use the Video renderer that comes with hang because it assumes a single video source.
	// So we use the Video class directly to get individual frames.
	broadcast: Broadcast;

	// The avatar image.
	avatar = new Image();

	// The size of the avatar in pixels.
	avatarSize = new Signal<Vector | undefined>(undefined);

	// The desired size of the video in pixels.
	targetSize = new Signal<Vector>(Vector.create(128, 128));

	// Time-based transition tracking (in milliseconds)
	#frameTransition: DOMHighResTimeStamp = 0;
	frameActive: boolean = false;

	// Computed opacity values (calculated once per frame instead of per pixel)
	frameOpacity: number = 0;

	// WebGL textures for this broadcast
	frameTexture: WebGLTexture; // Video texture
	avatarTexture: WebGLTexture; // Avatar texture
	#gl: WebGL2RenderingContext;

	// Render avatars and emojis at this size
	#renderSize = new Signal<number>(128);

	constructor(broadcast: Broadcast) {
		this.broadcast = broadcast;

		this.#gl = broadcast.canvas.gl;

		// Create the textures
		this.frameTexture = this.#gl.createTexture();
		this.avatarTexture = this.#gl.createTexture();

		// Initialize textures with 1x1 transparent pixel to make them renderable
		const emptyPixel = new Uint8Array([0, 0, 0, 0]);
		for (const texture of [this.frameTexture, this.avatarTexture]) {
			this.#gl.bindTexture(this.#gl.TEXTURE_2D, texture);
			this.#gl.texImage2D(
				this.#gl.TEXTURE_2D,
				0,
				this.#gl.RGBA,
				1,
				1,
				0,
				this.#gl.RGBA,
				this.#gl.UNSIGNED_BYTE,
				emptyPixel,
			);
			this.#gl.texParameteri(this.#gl.TEXTURE_2D, this.#gl.TEXTURE_WRAP_S, this.#gl.CLAMP_TO_EDGE);
			this.#gl.texParameteri(this.#gl.TEXTURE_2D, this.#gl.TEXTURE_WRAP_T, this.#gl.CLAMP_TO_EDGE);
			this.#gl.texParameteri(this.#gl.TEXTURE_2D, this.#gl.TEXTURE_MIN_FILTER, this.#gl.LINEAR);
			this.#gl.texParameteri(this.#gl.TEXTURE_2D, this.#gl.TEXTURE_MAG_FILTER, this.#gl.LINEAR);
		}
		this.#gl.bindTexture(this.#gl.TEXTURE_2D, null);

		// Set up texture upload effects
		this.broadcast.signals.effect(this.#runFrame.bind(this));
		this.broadcast.signals.effect(this.#runAvatar.bind(this));
		this.broadcast.signals.effect(this.#runTargetSize.bind(this));

		this.broadcast.signals.effect(this.#runRenderSize.bind(this));
	}

	#runAvatar(effect: Effect) {
		const avatar = effect.get(this.broadcast.source.user.avatar);
		if (!avatar) return;

		// TODO only set the avatar if it successfully loads
		const newAvatar = new Image();

		// Enable CORS for external avatar images
		newAvatar.crossOrigin = "anonymous";

		// For SVGs, load at higher resolution to avoid pixelation
		// Set a reasonable size (e.g., 512x512) for better quality
		if (avatar.endsWith(".svg")) {
			const size = effect.get(this.#renderSize);
			newAvatar.width = size;
			newAvatar.height = size;
		}

		newAvatar.src = avatar;

		// Once the avatar loads, upload it to the texture
		effect.event(newAvatar, "load", () => {
			const avatarSize = Vector.create(
				newAvatar.naturalWidth || newAvatar.width,
				newAvatar.naturalHeight || newAvatar.height,
			);
			effect.set(this.avatarSize, avatarSize);

			effect.effect((effect) => {
				const size = effect.get(this.#renderSize);
				this.#imageToTexture(newAvatar, this.avatarTexture, size);
			});
		});
	}

	#imageToTexture(src: HTMLImageElement, dst: WebGLTexture, size: number) {
		const canvas = document.createElement("canvas");
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("Failed to get context");
		ctx.drawImage(src, 0, 0, size, size);

		const gl = this.#gl;
		gl.bindTexture(gl.TEXTURE_2D, dst);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	#runTargetSize(effect: Effect) {
		const display = effect.get(this.broadcast.source.video.display);
		if (display) {
			this.targetSize.set(Vector.create(display.width, display.height));
			return;
		}

		const avatar = effect.get(this.avatarSize);
		if (avatar) {
			// If the avatar is larger than 256x256, then shrink it to match the target area.
			const ratio = Math.sqrt(avatar.x * avatar.y) / 256;
			this.targetSize.set(avatar.div(ratio));
			return;
		}

		this.targetSize.set(Vector.create(128, 128));
	}

	#runFrame(effect: Effect) {
		const frame = effect.get(this.broadcast.source.video.frame);

		if (!!frame !== this.frameActive) {
			this.#frameTransition = performance.now();
			this.frameActive = !!frame;
		}

		if (frame) this.#frameToTexture(frame, this.frameTexture);
	}

	#frameToTexture(src: VideoFrame, dst: WebGLTexture) {
		const gl = this.#gl;
		gl.bindTexture(gl.TEXTURE_2D, dst);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	#runRenderSize(effect: Effect) {
		const scale = effect.get(Settings.render.scale);
		const target = effect.get(this.broadcast.bounds).size;
		const size = Math.sqrt(target.x * target.y) * scale;
		// Increase to the nearest power of 2
		const power = Math.ceil(Math.log2(size));
		this.#renderSize.set(Math.min(2 ** power, 512 * scale));
	}

	// Update opacity values based on current time (called once per frame)
	tick(now: DOMHighResTimeStamp) {
		const TRANSITION_DURATION = 300; // ms

		// Calculate frame opacity
		const frameElapsed = now - this.#frameTransition;
		if (this.frameActive) {
			this.frameOpacity = Math.min(1, Math.max(0, frameElapsed / TRANSITION_DURATION));
		} else {
			this.frameOpacity = Math.max(0, 1 - frameElapsed / TRANSITION_DURATION);
		}
	}

	close() {
		this.#gl.deleteTexture(this.frameTexture);
		this.#gl.deleteTexture(this.avatarTexture);
	}
}
