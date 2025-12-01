/**
 * Main HangStats web component
 * Provides real-time streaming statistics display with SolidJS reactivity
 * @module element
 */

import { render } from "solid-js/web";
import { Effect, Signal } from "@kixelated/signals";
import { StatsWrapper } from "./components/StatsWrapper";
import "./style/index.scss";

export default class HangStats extends HTMLElement {
	active = new Signal<HangStatsInstance | undefined>(undefined);

	connectedCallback() {
		this.active.set(new HangStatsInstance(this));
	}

	disconnectedCallback() {
		this.active.update((prev) => {
			prev?.close();
			return undefined;
		});
	}
}

export class HangStatsInstance {
	parent: HangStats;
	#signals: Effect;

	#dispose?: () => void;

	constructor(parent: HangStats) {
		this.parent = parent;
		this.#signals = new Effect();
		this.#signals.effect(this.#render.bind(this));
	}

	close() {
		this.#dispose?.();
	}

	#render(): void {
		this.parent.innerHTML = "";

		const container = document.createElement("div");
		container.className = "stats__container";

		this.#dispose = render(() => <StatsWrapper />, container);

		this.parent.appendChild(container);
	}
}