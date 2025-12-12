import type { Publish } from "@moq/hang";
import { Effect, Signal } from "@moq/signals";
import * as DOM from "@moq/signals/dom";
import type { Broadcast } from "./broadcast";
import { Bounds, Vector } from "./geometry";

export class Locator {
	broadcast: Broadcast<Publish.Broadcast>;
	signals = new Effect();

	#visible = new Signal(true);

	constructor(broadcast: Broadcast<Publish.Broadcast>) {
		this.broadcast = broadcast;

		this.signals.effect(this.#render.bind(this));

		// Start fading out after 7 seconds
		this.signals.timer(() => {
			this.#visible.set(false);
		}, 7000);
	}

	#render(effect: Effect) {
		// Container for arrow and text
		const root = DOM.create("div", {
			className: "fixed pointer-events-none transition-opacity duration-1000 animate-throb",
		});

		// Arrow pointing down
		const arrow = DOM.create("div", {
			className: "absolute left-1/2 -translate-x-1/2",
		});

		// Triangle SVG for the arrow
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("width", "32");
		svg.setAttribute("height", "32");
		svg.setAttribute("viewBox", "0 0 32 32");

		const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
		path.setAttribute("d", "M16 28 L8 16 L24 16 Z");
		path.setAttribute("fill", "#FFD700");
		path.setAttribute("stroke", "#000");
		path.setAttribute("stroke-width", "2");

		svg.appendChild(path);
		arrow.appendChild(svg);
		root.appendChild(arrow);

		// "YOU" text above the arrow
		const text = DOM.create("div", {
			className:
				"absolute left-1/2 -translate-x-1/2 -top-8 font-bold text-2xl text-[#FFD700] [text-shadow:_0_0_8px_rgb(0_0_0_/_80%),_2px_2px_4px_rgb(0_0_0)]",
			textContent: "YOU",
		});
		root.appendChild(text);

		// Update the position based on broadcast bounds
		const updatePosition = (bounds: Bounds, viewport: Vector) => {
			const canvasRect = this.broadcast.canvas.element.getBoundingClientRect();

			// Scale bounds from canvas coordinates to page coordinates
			const scaleX = canvasRect.width / viewport.x;
			const scaleY = canvasRect.height / viewport.y;

			// Calculate position above the broadcast
			const x = (bounds.position.x + bounds.size.x / 2) * scaleX + canvasRect.left;
			const y = bounds.position.y * scaleY + canvasRect.top;

			// Position the locator, with some gap above the broadcast
			const gap = 60; // Distance above the broadcast
			const top = Math.max(canvasRect.top, y - gap);
			const left = Math.min(Math.max(canvasRect.left, x), canvasRect.left + canvasRect.width);

			root.style.left = `${left}px`;
			root.style.top = `${top}px`;
		};

		// Update position when bounds or viewport change
		effect.effect((effect) => {
			const bounds = effect.get(this.broadcast.bounds);
			const viewport = effect.get(this.broadcast.canvas.viewport);
			updatePosition(bounds, viewport);
		});

		// Set z-index based on broadcast z-index
		effect.effect((effect) => {
			const z = effect.get(this.broadcast.position).z;
			root.style.zIndex = `${100 + z}`;
		});

		// Control opacity based on visible signal
		effect.effect((effect) => {
			const visible = effect.get(this.#visible);
			root.style.opacity = visible ? "1" : "0";
		});

		DOM.render(effect, document.body, root);
	}

	close() {
		this.signals.close();
	}
}
