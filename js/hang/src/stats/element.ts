import { Effect, Signal } from "@kixelated/signals";
import * as DOM from "@kixelated/signals/dom";
import { COLORS, SPACING, SVGS } from "./config";

export type Icons = "network" | "video" | "audio" | "buffer";

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

	constructor(parent: HangStats) {
		this.parent = parent;
		this.#signals = new Effect();
		this.#signals.effect(this.#render.bind(this));
	}

	close() { }

	private _createItem(icon: Icons, svg: string): HTMLDivElement {
		const color = COLORS[icon];

		const item: HTMLDivElement = DOM.create("div", {
			className: `hang-stats-item hang-stats-theme-${icon}`,
		});

		item.style.setProperty("--color-primary", color.primary);
		item.style.setProperty("--color-bg-primary", color.bgPrimary);
		item.style.setProperty("--color-bg-secondary", color.bgSecondary);

		const iconWrapper: HTMLDivElement = DOM.create("div", {
			className: `hang-icon-wrapper`,
			innerHTML: svg,
		});

		const text: HTMLSpanElement = DOM.create("span", {
			className: `hang-stats-item-text`,
			textContent: icon,
		});

		const data: HTMLSpanElement = DOM.create("span", {
			className: `hang-stats-item-data`,
			textContent: "N/A",
		});

		const detailWrapper: HTMLDivElement = DOM.create("div", {
			className: "hang-stats-item-detail",
		});

		detailWrapper.appendChild(text);
		detailWrapper.appendChild(data);

		item.appendChild(iconWrapper);
		item.appendChild(detailWrapper);

		return item;
	}

	#render(effect: Effect): void {
		const style = DOM.create("style", {
			textContent: `
				hang-stats {
					display: flex;
					align-items: flex-start;
					justify-content: center;
					position: absolute;
					inset: 0;
					pointer-events: none;
					margin: 16px 0 0 0;
					z-index: 2;
				}

				.hang-stats-panel {
					display: flex;
					flex-direction: row;
					column-gap: 24px;
					background-color: var(--color-black);
					border: 1px solid var(--color-dark-grey);
					border-radius: 12px;
					padding: 24px;
					pointer-events: auto;

					.hang-stats-item {
						display: flex;
						flex-direction: row;
						column-gap: var(--spacing-m);
						padding-right: 24px;
						border-right: 1px solid var(--color-dark-grey);

						&:last-child {
							border-right: none;
							padding-right: 0;
						}

						.hang-icon-wrapper {
							padding: var(--spacing-s);
							border-radius: 8px;
							width: fit-content;
						}

						.hang-stats-item-detail {
							display: flex;
							flex-direction: column;
							justify-content: space-evenly;
							
							.hang-stats-item-text {
								font-size: 12px;
								font-weight: 500;
								line-height: 12px;
								text-transform: capitalize;
								color: var(--color-light-grey);
							}

							.hang-stats-item-data {
								font-size: 16px;
								font-weight: bold;
								line-height: 16px;
							}
						}

						&.hang-stats-theme-network,
						&.hang-stats-theme-video,
						&.hang-stats-theme-audio,
						&.hang-stats-theme-buffer {
							.hang-icon-wrapper {
								background: linear-gradient(135deg, var(--color-bg-primary) 0%, var(--color-bg-secondary) 100%);

								.hang-icon {
									color: var(--color-primary);
								}
							}

							.hang-stats-item-detail {
								.hang-stats-item-data {
									color: var(--color-primary);
								}
							}
						}
					}
				}
			`,
		});

		const panel = DOM.create("div", {
			className: "hang-stats-panel",
		});

		panel.style.setProperty("--color-light-grey", COLORS.common.lightGrey);
		panel.style.setProperty("--color-dark-grey", COLORS.common.darkGrey);
		panel.style.setProperty("--color-black", COLORS.common.black);
		
		panel.style.setProperty("--spacing-s", SPACING.s);
		panel.style.setProperty("--spacing-m", SPACING.m);
		panel.style.setProperty("--spacing-l", SPACING.l);

		Object.entries(SVGS).forEach(([icon, svg]) => {
			const item = this._createItem(icon as Icons, svg);
			console.log("item", item);
			panel.appendChild(item);
		});

		DOM.render(effect, this.parent, [style, panel]);
	}
}

customElements.define("hang-stats", HangStats);

declare global {
	interface HTMLElementTagNameMap {
		"hang-stats": HangStats;
	}
}