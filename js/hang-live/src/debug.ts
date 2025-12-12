import { Publish, Watch } from "@moq/hang";
import { Effect } from "@moq/signals";
import * as DOM from "@moq/signals/dom";
import type { Broadcast } from "./broadcast";
import type { Canvas } from "./canvas";
import type { Bounds, Vector } from "./geometry";
import Settings from "./settings";

export class Debug {
	canvas: Canvas;
	broadcast: Broadcast;

	signals = new Effect();

	constructor(broadcast: Broadcast, canvas: Canvas) {
		this.broadcast = broadcast;
		this.canvas = canvas;

		this.signals.effect(this.#render.bind(this));
	}

	#render(effect: Effect) {
		if (!effect.get(Settings.debug.tracks)) return;

		const root = DOM.create("div", {
			className: "fixed pointer-events-none select-none",
		});

		// Update the position of the debug overlay when the broadcast bounds or viewport changes
		const updatePosition = (bounds: Bounds, viewport: Vector) => {
			// Get the canvas element's position on the page
			const canvasRect = this.canvas.element.getBoundingClientRect();

			// Scale bounds from canvas coordinates to page coordinates
			const scaleX = canvasRect.width / viewport.x;
			const scaleY = canvasRect.height / viewport.y;

			// Transform bounds to page coordinates
			const pageBounds = {
				x: bounds.position.x * scaleX + canvasRect.left,
				y: bounds.position.y * scaleY + canvasRect.top,
				width: bounds.size.x * scaleX,
				height: bounds.size.y * scaleY,
			};

			root.style.left = `${Math.round(pageBounds.x)}px`;
			root.style.top = `${Math.round(pageBounds.y)}px`;
			root.style.width = `${Math.round(pageBounds.width)}px`;
			root.style.height = `${Math.round(pageBounds.height)}px`;
		};

		// Update video info boxes for each rendition
		effect.effect((effect) => {
			const catalog = effect.get(this.broadcast.source.video.catalog);

			if (!catalog) return;

			const container = DOM.create("div", {
				className: "absolute top-1 right-1 flex flex-col gap-1",
			});

			// Create a box for each rendition
			for (const [name, rendition] of Object.entries(catalog.renditions)) {
				const box = DOM.create("div", {
					className:
						"bg-black/75 text-white px-2 py-1 rounded font-mono text-[11px] leading-snug whitespace-nowrap",
				});

				// Highlight active rendition
				if (this.broadcast.source instanceof Watch.Broadcast) {
					const active = effect.get(this.broadcast.source.video.active);
					if (active === name) {
						box.className += " ring-2 ring-green-500";
					}
				} else if (this.broadcast.source instanceof Publish.Broadcast) {
					if (name === Publish.Video.Root.TRACK_HD && effect.get(this.broadcast.source.video.hd.active)) {
						box.className += " ring-2 ring-green-500";
					} else if (
						name === Publish.Video.Root.TRACK_SD &&
						effect.get(this.broadcast.source.video.sd.active)
					) {
						box.className += " ring-2 ring-green-500";
					}
				}

				// Format: "avc1: 1920x1080 @ 6Mb/s"
				let content = `${rendition.codec.split(".").shift()}: `;

				if (rendition.codedWidth && rendition.codedHeight) {
					content += `${rendition.codedWidth}x${rendition.codedHeight}`;
				} else {
					content += "?x?";
				}

				if (rendition.bitrate !== undefined) {
					// Round to 2 significant figures and convert to Mb/s
					const bitrateMbps = rendition.bitrate / 1_000_000;
					const rounded = Number(bitrateMbps.toPrecision(2));
					content += ` @ ${rounded}Mb/s`;
				}

				box.textContent = content;
				DOM.render(effect, container, box);
			}

			DOM.render(effect, root, container);
		});

		// Update audio info boxes for each rendition
		effect.effect((effect) => {
			const catalog = effect.get(this.broadcast.source.audio.catalog);
			if (!catalog) return;

			const container = DOM.create("div", {
				className: "absolute bottom-1 right-1 flex flex-col gap-1",
			});

			// Create a box for each rendition
			for (const [name, rendition] of Object.entries(catalog.renditions)) {
				const box = DOM.create("div", {
					className:
						"bg-black/75 text-white px-2 py-1 rounded font-mono text-[11px] leading-snug whitespace-nowrap",
				});

				// Highlight active rendition
				if (this.broadcast.source instanceof Watch.Broadcast) {
					const active = effect.get(this.broadcast.source.audio.active);
					if (active === name) {
						box.className += " ring-2 ring-green-500";
					}
				} else if (this.broadcast.source instanceof Publish.Broadcast) {
					if (effect.get(this.broadcast.source.audio.active)) {
						box.className += " ring-2 ring-green-500";
					}
				}

				// Format: "opus: 48kHz @ 128kb/s"
				// Trim to only show the part after the last slash
				let content = `${rendition.codec}: `;

				if (rendition.sampleRate) {
					const sampleRateKhz = rendition.sampleRate / 1000;
					content += `${sampleRateKhz}kHz`;
				}

				if (rendition.bitrate !== undefined) {
					// Round to 2 significant figures and convert to kb/s
					const bitrateKbps = rendition.bitrate / 1000;
					const rounded = Number(bitrateKbps.toPrecision(2));
					if (rendition.sampleRate) {
						content += ` @ ${rounded}kb/s`;
					} else {
						content += `${rounded}kb/s`;
					}
				}

				box.textContent = content;
				DOM.render(effect, container, box);
			}

			DOM.render(effect, root, container);
		});

		// Update position when bounds, viewport, or zoom change
		effect.effect((effect) => {
			const bounds = effect.get(this.broadcast.bounds);
			const viewport = effect.get(this.broadcast.canvas.viewport);
			updatePosition(bounds, viewport);
		});

		// Update position when window scrolls
		effect.event(
			window,
			"scroll",
			() => {
				const bounds = this.broadcast.bounds.peek();
				const viewport = this.broadcast.canvas.viewport.peek();
				updatePosition(bounds, viewport);
			},
			{ passive: true },
		);

		// Update z-index based on broadcast position
		effect.effect((effect) => {
			const z = effect.get(this.broadcast.position).z;
			root.style.zIndex = `${100 + z}`;
		});

		DOM.render(effect, document.body, root);
	}

	close() {
		this.signals.close();
	}
}
