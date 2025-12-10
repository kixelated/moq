import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StatsContext } from "../../context";
import type { HandlerProps } from "../../types";
import { StatsPanel } from "../StatsPanel";

const mockAudioVideo: HandlerProps = {
	audio: { source: { active: { peek: () => "audio-data" } } },
	video: { source: { display: { peek: () => ({ width: 1920, height: 1080 }) } } },
};

describe("StatsPanel", () => {
	let container: HTMLDivElement;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
	});

	afterEach(() => {
		document.body.removeChild(container);
	});

	it("renders with correct base class", () => {
		render(
			() => (
				<StatsContext.Provider value={mockAudioVideo}>
					<StatsPanel />
				</StatsContext.Provider>
			),
			container,
		);

		const panel = container.querySelector(".stats__panel");
		expect(panel).toBeTruthy();
	});

	it("renders all metric items", () => {
		render(
			() => (
				<StatsContext.Provider value={mockAudioVideo}>
					<StatsPanel />
				</StatsContext.Provider>
			),
			container,
		);

		const items = container.querySelectorAll(".stats__item");
		expect(items.length).toBe(4);
	});

	it("renders items with correct icon types", () => {
		const expectedIcons = ["network", "video", "audio", "buffer"];
		render(
			() => (
				<StatsContext.Provider value={mockAudioVideo}>
					<StatsPanel />
				</StatsContext.Provider>
			),
			container,
		);

		const items = container.querySelectorAll(".stats__item");
		items.forEach((item, index) => {
			expect(item.classList.contains(`stats__item--${expectedIcons[index]}`)).toBe(true);
		});
	});

	it("renders each item with icon wrapper", () => {
		render(
			() => (
				<StatsContext.Provider value={mockAudioVideo}>
					<StatsPanel />
				</StatsContext.Provider>
			),
			container,
		);

		const wrappers = container.querySelectorAll(".stats__icon-wrapper");
		expect(wrappers.length).toBe(4);
	});

	it("renders each item with detail section", () => {
		render(
			() => (
				<StatsContext.Provider value={mockAudioVideo}>
					<StatsPanel />
				</StatsContext.Provider>
			),
			container,
		);

		const details = container.querySelectorAll(".stats__item-detail");
		expect(details.length).toBe(4);
	});

	it("maintains correct DOM structure", () => {
		render(
			() => (
				<StatsContext.Provider value={mockAudioVideo}>
					<StatsPanel />
				</StatsContext.Provider>
			),
			container,
		);

		const panel = container.querySelector(".stats__panel");
		const items = panel?.querySelectorAll(".stats__item");

		expect(panel?.children.length).toBe(4);
		items?.forEach((item) => {
			expect(item.querySelector(".stats__icon-wrapper")).toBeTruthy();
			expect(item.querySelector(".stats__item-detail")).toBeTruthy();
		});
	});
});
