import type { VideoStreamTrack } from ".";

// Firefox doesn't support MediaStreamTrackProcessor so we need to use a polyfill.
// Based on: https://jan-ivar.github.io/polyfills/mediastreamtrackprocessor.js
// Thanks Jan-Ivar
export function VideoTrackProcessor(track: VideoStreamTrack): ReadableStream<VideoFrame> {
	// @ts-expect-error No typescript types yet.
	if (self.MediaStreamTrackProcessor) {
		// @ts-expect-error No typescript types yet.
		return new self.MediaStreamTrackProcessor({ track }).readable;
	}

	console.warn("Using MediaStreamTrackProcessor polyfill; performance might suffer.");

	const settings = track.getSettings();
	if (!settings) {
		throw new Error("track has no settings");
	}

	let video: HTMLVideoElement;
	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D;
	let last: DOMHighResTimeStamp;

	const frameRate = settings.frameRate ?? 30;

	return new ReadableStream<VideoFrame>({
		async start() {
			video = document.createElement("video") as HTMLVideoElement;
			video.srcObject = new MediaStream([track]);
			await Promise.all([
				video.play(),
				new Promise((r) => {
					video.onloadedmetadata = r;
				}),
			]);
			// TODO use offscreen canvas
			canvas = document.createElement("canvas");
			canvas.width = video.videoWidth;
			canvas.height = video.videoHeight;

			const c = canvas.getContext("2d", { desynchronized: true });
			if (!c) {
				throw new Error("failed to create canvas context");
			}
			ctx = c;
			last = performance.now();
		},
		async pull(controller) {
			while (true) {
				const now = performance.now();
				if (now - last < 1000 / frameRate) {
					await new Promise((r) => requestAnimationFrame(r));
					continue;
				}

				last = now;
				ctx.drawImage(video, 0, 0);
				controller.enqueue(new VideoFrame(canvas, { timestamp: last * 1000 }));
			}
		},
	});
}
