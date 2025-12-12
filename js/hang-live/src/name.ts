import { Effect, Signal } from "@moq/signals";
import * as DOM from "@moq/signals/dom";
import type { Broadcast } from "./broadcast";
import type { Canvas } from "./canvas";
import { Bounds, Vector } from "./geometry";

export class Name {
	canvas: Canvas;
	broadcast: Broadcast;

	signals = new Effect();

	#hovering = new Signal(false);
	#profile = new Signal(false);

	constructor(broadcast: Broadcast, canvas: Canvas) {
		this.broadcast = broadcast;
		this.canvas = canvas;

		this.signals.effect(this.#render.bind(this));
	}

	setHovering(hovering: boolean) {
		this.#hovering.set(hovering);
	}

	setProfile(profile: boolean) {
		this.#profile.set(profile);
	}

	#render(effect: Effect) {
		const root = DOM.create("div", {
			className:
				"fixed pointer-events-none transition-opacity duration-200 text-white font-bold [text-shadow:_-1px_-1px_0_#000,_1px_-1px_0_#000,_-1px_1px_0_#000,_1px_1px_0_#000] overflow-hidden text-ellipsis whitespace-nowrap select-none",
		});

		// Update the position of the name when the broadcast bounds or viewport changes
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
			};

			// Position name at top-left of broadcast with offset
			const fontSize = 12;
			const offset = 12;

			// Clamp position to stay within canvas bounds
			const left = Math.round(
				Math.max(canvasRect.left + offset, Math.min(pageBounds.x + offset, canvasRect.right - offset)),
			);
			const top = Math.round(
				Math.max(
					canvasRect.top + offset,
					Math.min(pageBounds.y + offset, canvasRect.bottom - fontSize - offset),
				),
			);

			root.style.left = `${left}px`;
			root.style.top = `${top}px`;
			root.style.fontSize = `${fontSize}px`;

			// Max width should be constrained by both broadcast width and canvas bounds
			const maxWidthFromBroadcast = Math.max(0, pageBounds.width - 2 * offset);
			const maxWidthFromCanvas = Math.max(0, canvasRect.right - left - offset);
			root.style.maxWidth = `${Math.min(maxWidthFromBroadcast, maxWidthFromCanvas)}px`;
		};

		// Update name text
		effect.effect((effect) => {
			const name = effect.get(this.broadcast.source.user.name);
			root.textContent = name || "";
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

		// Control opacity based on hovering or profile mode
		effect.effect((effect) => {
			const hovering = effect.get(this.#hovering);
			const profile = effect.get(this.#profile);
			root.style.opacity = hovering || profile ? "1" : "0";
		});

		DOM.render(effect, document.body, root);
	}

	close() {
		this.signals.close();
	}
}
